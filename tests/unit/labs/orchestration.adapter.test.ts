import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerOrchestrationAdapter } from '../../../src/features/labs/adapters/container-orchestration.adapter';
import { AppError, NotFoundError } from '../../../src/shared/errors';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../src/app/config', () => ({
  env: {
    CONTAINER_ORCHESTRATION_API_URL: 'http://orchestrator.test:9000/',
    CONTAINER_ORCHESTRATION_API_KEY: 'test-orchestrator-key',
  },
}));

vi.mock('../../../src/shared/logger', () => ({ logger: loggerMock }));

const BASE = 'http://orchestrator.test:9000';
const SECRET_COMMAND = 'cat /etc/shadow-test-marker';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ContainerOrchestrationAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ContainerOrchestrationAdapter;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    adapter = new ContainerOrchestrationAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an exec response without exitCode instead of defaulting it to 0', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ stdout: 'ok' }));

    const failure = adapter.executeCommand(7, SECRET_COMMAND);

    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
    });
    const logged = JSON.stringify(loggerMock.error.mock.calls);
    expect(logged).not.toContain(SECRET_COMMAND);
  });

  it('reports an aborted exec as timedOut with exit code 124 (never a pass)', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));

    const result = await adapter.executeCommand(7, 'sleep 99', { timeoutMs: 1000 });

    expect(result).toMatchObject({ timedOut: true, exitCode: 124, stdout: '', stderr: '' });
  });

  it('returns null for a 404 instance lookup', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"not found"}', { status: 404 }));

    await expect(adapter.getInstance(7)).resolves.toBeNull();
  });

  it('maps a 500 from an instance call to 503 LAB_ENV_UNREACHABLE', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await expect(adapter.getInstance(7)).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, instanceId: 7 }),
      expect.any(String),
    );
  });

  it('refuses a catalog slug that does not match CxxMxxLxx without sending a request', async () => {
    await expect(adapter.getCatalogLab('../admin')).rejects.toBeInstanceOf(NotFoundError);
    await expect(adapter.getCatalogLab('c01m03l01')).rejects.toMatchObject({
      statusCode: 404,
      errors: [{ code: 'CATALOG_LAB_NOT_FOUND' }],
    });
    await expect(adapter.getCatalogGuide('C01M03')).rejects.toMatchObject({
      errors: [{ code: 'CATALOG_LAB_NOT_FOUND' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer key, redirect error policy and a validated exec body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ exitCode: 0, stdout: 'hello\n' }));

    const result = await adapter.executeCommand(7, 'echo hello', { timeoutMs: 15000 });

    expect(result).toMatchObject({ exitCode: 0, stdout: 'hello\n', timedOut: false, stderr: '' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${BASE}/instances/7/exec`);
    expect(init.headers.Authorization).toBe('Bearer test-orchestrator-key');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({ command: 'echo hello', timeoutMs: 15000 });
  });

  it('creates an instance with labSlug and without any root password', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hostname: 'lab-7',
        assignedIp: '10.0.0.7',
        sshPort: 2222,
        terminalWsUrl: 'http://orchestrator.test:7701',
      }),
    );

    await adapter.createInstance({
      labId: 3,
      labSlug: 'C01M03L01',
      instanceId: 7,
      ramGb: 2,
      cpuCores: 2,
      diskGb: 20,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ labSlug: 'C01M03L01', instanceId: 7 });
    expect(body).not.toHaveProperty('rootPassword');
  });

  it('maps a failed catalog call to 503 CATALOG_UNAVAILABLE and a catalog 404 to null', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    await expect(adapter.listCatalog()).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'CATALOG_UNAVAILABLE' }],
    });

    fetchMock.mockResolvedValueOnce(new Response('{"code":"LAB_NOT_FOUND"}', { status: 404 }));
    await expect(adapter.getCatalogLab('C01M03L01')).resolves.toBeNull();
  });

  it('checkHealth returns available=true on 200 and assertReachable throws 503 LAB_ENV_UNREACHABLE on outage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    await expect(adapter.checkHealth()).resolves.toEqual({ available: true });

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(adapter.checkHealth()).resolves.toMatchObject({ available: false });

    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    await expect(adapter.assertReachable()).rejects.toMatchObject({
      statusCode: 503,
      errors: [{ code: 'LAB_ENV_UNREACHABLE' }],
    });
  });
});
