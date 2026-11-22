import { describe, expect, it, vi } from 'vitest';
import {
  HISTORY_COUNT_COMMAND,
  LabCheckService,
  normalizeAnswer,
  scalePoints,
} from '../../../src/features/labs/services/LabCheckService';
import type { LabStepCheck } from '../../../src/features/labs/dto/lab-spec.dto';

function execResult(overrides: Record<string, unknown> = {}) {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 5, ...overrides };
}

function makeService(results: Array<Record<string, unknown>> = [execResult()], statusCode = 200) {
  const orchestration = {
    executeCommand: vi.fn(),
    probeHttp: vi.fn(async () => ({ statusCode })),
  };
  for (const result of results) {
    orchestration.executeCommand.mockResolvedValueOnce(execResult(result));
  }
  return { service: new LabCheckService({ orchestration }), orchestration };
}

describe('LabCheckService.evaluate (contracts 2.1)', () => {
  it('command: passes iff the exit code matches', async () => {
    const check: LabStepCheck = { type: 'command', command: 'test -d /srv', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 };
    const { service, orchestration } = makeService([{ exitCode: 0 }, { exitCode: 1 }]);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: true, reason: 'passed' });
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'not_passed' });
    expect(orchestration.executeCommand).toHaveBeenCalledWith(1, 'test -d /srv', { timeoutMs: 15000 });
  });

  it('output: needs exit 0 and a matching trimmed stdout', async () => {
    const check: LabStepCheck = { type: 'output', command: 'cat /x', expect: { mode: 'exact', value: 'ok' }, timeoutMs: 15000 };
    const { service } = makeService([{ stdout: ' ok\n' }, { stdout: 'ok', exitCode: 2 }]);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false });
  });

  it('output regex and numeric matchers; an invalid regex never passes', async () => {
    const regex: LabStepCheck = { type: 'output', command: 'x', expect: { mode: 'regex', value: '^heartbeat_ok$' }, timeoutMs: 15000 };
    const numeric: LabStepCheck = { type: 'output', command: 'x', expect: { mode: 'numeric', value: 3, op: 'gte' }, timeoutMs: 15000 };
    const broken: LabStepCheck = { type: 'output', command: 'x', expect: { mode: 'regex', value: '(' }, timeoutMs: 15000 };
    const { service } = makeService([{ stdout: 'a\nheartbeat_ok\n' }, { stdout: '4' }, { stdout: 'abc' }, { stdout: '(' }]);
    await expect(service.evaluate(1, regex)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, numeric)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, numeric)).resolves.toMatchObject({ passed: false });
    await expect(service.evaluate(1, broken)).resolves.toMatchObject({ passed: false });
  });

  it('file: exitCode mode runs test -e, content modes run cat with the path single-quote escaped', async () => {
    const exists: LabStepCheck = { type: 'file', path: "/tmp/it's", expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 };
    const content: LabStepCheck = { type: 'file', path: '/etc/motd', expect: { mode: 'contains', value: 'hi' }, timeoutMs: 15000 };
    const { service, orchestration } = makeService([{ exitCode: 0 }, { stdout: 'oh hi' }]);
    await expect(service.evaluate(1, exists)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, content)).resolves.toMatchObject({ passed: true });
    expect(orchestration.executeCommand.mock.calls[0][1]).toBe("test -e '/tmp/it'\\''s'");
    expect(orchestration.executeCommand.mock.calls[1][1]).toBe("cat -- '/etc/motd'");
  });

  it('http: compares the probed status code', async () => {
    const check: LabStepCheck = { type: 'http', path: '/health', port: 80, expect: { mode: 'numeric', value: 200, op: 'eq' }, timeoutMs: 5000 };
    const { service, orchestration } = makeService([], 200);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: true, statusCode: 200 });
    expect(orchestration.probeHttp).toHaveBeenCalledWith(1, { path: '/health', port: 80, timeoutMs: 5000 });
  });

  it('a timed out command never passes', async () => {
    const check: LabStepCheck = { type: 'command', command: 'sleep 99', expect: { mode: 'exitCode', value: 124 }, timeoutMs: 1000 };
    const { service } = makeService([{ exitCode: 124, timedOut: true }]);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'timeout' });
  });

  it('a timed out output or file check never passes, even when the output would match', async () => {
    const output: LabStepCheck = { type: 'output', command: 'cat /x', expect: { mode: 'exact', value: 'ok' }, timeoutMs: 1000 };
    const file: LabStepCheck = { type: 'file', path: '/etc/motd', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 1000 };
    const { service } = makeService([{ stdout: 'ok', exitCode: 0, timedOut: true }, { exitCode: 0, timedOut: true }]);
    await expect(service.evaluate(1, output)).resolves.toMatchObject({ passed: false, reason: 'timeout' });
    await expect(service.evaluate(1, file)).resolves.toMatchObject({ passed: false, reason: 'timeout' });
  });

  it('output contains matcher and the exit-code requirement of output checks', async () => {
    const check: LabStepCheck = { type: 'output', command: 'cat /x', expect: { mode: 'contains', value: 'nginx' }, timeoutMs: 15000 };
    const { service } = makeService([{ stdout: 'running nginx\n' }, { stdout: 'running nginx', exitCode: 1 }, { stdout: 'apache' }]);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: true, reason: 'passed' });
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'not_passed' });
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'not_passed' });
  });

  it('numeric output ops compare the parsed stdout and NaN fails', async () => {
    const lt: LabStepCheck = { type: 'output', command: 'x', expect: { mode: 'numeric', value: 10, op: 'lt' }, timeoutMs: 15000 };
    const ne: LabStepCheck = { type: 'output', command: 'x', expect: { mode: 'numeric', value: 2, op: 'ne' }, timeoutMs: 15000 };
    const { service } = makeService([{ stdout: '4\n' }, { stdout: '2' }, { stdout: 'abc' }]);
    await expect(service.evaluate(1, lt)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, ne)).resolves.toMatchObject({ passed: false });
    await expect(service.evaluate(1, lt)).resolves.toMatchObject({ passed: false });
  });

  it('file exitCode 1 passes when the path must not exist', async () => {
    const absent: LabStepCheck = { type: 'file', path: '/tmp/gone', expect: { mode: 'exitCode', value: 1 }, timeoutMs: 15000 };
    const { service, orchestration } = makeService([{ exitCode: 1 }, { exitCode: 0 }]);
    await expect(service.evaluate(1, absent)).resolves.toMatchObject({ passed: true });
    await expect(service.evaluate(1, absent)).resolves.toMatchObject({ passed: false });
    expect(orchestration.executeCommand.mock.calls[0][1]).toBe("test -e '/tmp/gone'");
  });

  it('file content checks fail when cat exits non-zero even if the text matches', async () => {
    const check: LabStepCheck = { type: 'file', path: '/etc/motd', expect: { mode: 'contains', value: 'hi' }, timeoutMs: 15000 };
    const { service } = makeService([{ stdout: 'hi', exitCode: 1 }]);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'not_passed' });
  });

  it('http numeric checks fail on a different status code', async () => {
    const check: LabStepCheck = { type: 'http', path: '/health', port: 80, expect: { mode: 'numeric', value: 200, op: 'eq' }, timeoutMs: 5000 };
    const { service } = makeService([], 404);
    await expect(service.evaluate(1, check)).resolves.toMatchObject({ passed: false, reason: 'not_passed', statusCode: 404 });
  });
});

describe('LabCheckService.runSetup / readHistoryCount', () => {
  it('runs setup commands in order and fails 503 LAB_ENV_UNREACHABLE on a non-zero exit', async () => {
    const { service, orchestration } = makeService([{ exitCode: 0 }, { exitCode: 1 }]);
    await expect(service.runSetup(1, ['a', 'b', 'c'])).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
    });
    expect(orchestration.executeCommand).toHaveBeenCalledTimes(2);
    expect(orchestration.executeCommand.mock.calls[0][2]).toEqual({ timeoutMs: 30000 });
  });

  it('parses the history count, treating unparseable output as 0', async () => {
    const { service, orchestration } = makeService([{ stdout: ' 12\n' }, { stdout: 'nope' }]);
    await expect(service.readHistoryCount(1)).resolves.toBe(12);
    await expect(service.readHistoryCount(1)).resolves.toBe(0);
    expect(orchestration.executeCommand).toHaveBeenCalledWith(1, HISTORY_COUNT_COMMAND);
  });

  it('reads the history count from wc output and treats empty output as 0', async () => {
    const { service } = makeService([{ stdout: '12\n' }, { stdout: '' }]);
    await expect(service.readHistoryCount(1)).resolves.toBe(12);
    await expect(service.readHistoryCount(1)).resolves.toBe(0);
  });

  it('readHistoryCount fails 503 LAB_ENV_UNREACHABLE when the history read times out', async () => {
    const { service } = makeService([{ timedOut: true, exitCode: 124 }]);
    await expect(service.readHistoryCount(1)).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
    });
  });

  it('fails 503 LAB_ENV_UNREACHABLE when the setup budget is exhausted before the next command', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      // Start at 0, then the first command sees 0 elapsed, the second sees 60 s elapsed.
      nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(60_000);
      const { service, orchestration } = makeService([{ exitCode: 0 }]);
      await expect(service.runSetup(1, ['a', 'b'])).rejects.toMatchObject({
        statusCode: 503,
        errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
      });
      expect(orchestration.executeCommand).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('caps each setup command at the remaining total budget', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      // Command 1 starts at 0 s (30 s ceiling), command 2 starts at 45 s (15 s left), command 3 at 60 s (none left).
      nowSpy
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(45_000)
        .mockReturnValue(60_000);
      const { service, orchestration } = makeService([{ exitCode: 0 }, { exitCode: 0 }]);
      await expect(service.runSetup(1, ['a', 'b', 'c'])).rejects.toMatchObject({ statusCode: 503 });
      expect(orchestration.executeCommand).toHaveBeenCalledTimes(2);
      expect(orchestration.executeCommand.mock.calls[0][2]).toEqual({ timeoutMs: 30000 });
      expect(orchestration.executeCommand.mock.calls[1][2]).toEqual({ timeoutMs: 15000 });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('normalizeAnswer / scalePoints', () => {
  it('applies each normalization mode', () => {
    expect(normalizeAnswer('  Nginx ', 'none')).toBe('  Nginx ');
    expect(normalizeAnswer('  Nginx ', 'trim')).toBe('Nginx');
    expect(normalizeAnswer('  Nginx ', 'trim_lower')).toBe('nginx');
    expect(normalizeAnswer('  Web   Server ', 'collapse_ws_lower')).toBe('web server');
  });

  it('scales and rounds positive awards and never goes negative', () => {
    expect(scalePoints(25, 1.5)).toBe(38);
    expect(scalePoints(25, 1)).toBe(25);
    expect(scalePoints(-5, 2)).toBe(0);
  });

  it('uses the caller-provided multiplier, so 0 scales every award to 0', () => {
    expect(scalePoints(25, 0)).toBe(0);
  });
});
