import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from '../../../app/database';
import { NotFoundError } from '../../../shared/errors';
import type { PointsSourceType } from '../dto/gamification.dto';
import { formatAwardDescription, isValidAwardKey } from '../config/award-keys';
import { ledgerRepository, type LedgerRepository, type Tx } from '../repositories/ledger.repository';

export type { Tx } from '../repositories/ledger.repository';
export type { AwardKind } from '../config/award-keys';
export { awardKeys, parseAwardKey } from '../config/award-keys';

export interface AwardInput {
  userId: number;
  /** Idempotency key built with `awardKeys.*`. */
  key: string;
  /** Signed delta; penalties are negative. 0 writes nothing. */
  points: number;
  sourceType: PointsSourceType;
  sourceId: number | null;
  /** Human label stored after the key prefix (capped at 200 chars). */
  label: string;
}

export interface AwardResult {
  /** False when the key already existed or `points === 0`. */
  applied: boolean;
  historyId: number | null;
  /** Delta written by this call (0 when nothing was written). */
  pointsChange: number;
  /** Running balance after this call. */
  balance: number;
}

export interface AwardServiceDeps {
  ledger: Pick<LedgerRepository, 'lockUser' | 'hasKey' | 'latestBalance' | 'insert'>;
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): AwardServiceDeps {
  return {
    ledger: ledgerRepository,
    transaction: (fn) => db.transaction(fn),
  };
}

interface LockContext {
  userId: number;
  tx: Tx;
}

/**
 * The single writer of `points_history` (contracts §0.3, §5.2).
 *
 * Once-only semantics without unique indexes: every unit of work opens a
 * transaction whose FIRST statement locks the user row
 * (`SELECT ... FROM users WHERE user_id = ? FOR UPDATE`), then checks and
 * inserts. While the lock is held every write MUST go through the given `tx`
 * (a write through the global `db` to a table with an FK to users would wait
 * on this very lock). Never hold the lock across a network call.
 */
export class AwardService {
  private readonly lockContext = new AsyncLocalStorage<LockContext>();

  constructor(private readonly deps: AwardServiceDeps = defaultDeps()) {}

  /** db.transaction + user-row FOR UPDATE first (NotFoundError if the user is missing). */
  async withUserLock<T>(userId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
    assertUserId(userId);
    if (this.lockContext.getStore()) {
      // A nested lock opens a second connection that waits on the first
      // transaction's row lock until innodb_lock_wait_timeout: fail fast.
      throw new Error('awardService.withUserLock must not be nested; pass the outer tx instead.');
    }
    return this.deps.transaction(async (tx) => {
      const exists = await this.deps.ledger.lockUser(tx, userId);
      if (!exists) {
        throw new NotFoundError('User not found.');
      }
      return this.lockContext.run({ userId, tx }, () => fn(tx));
    });
  }

  /**
   * Idempotent by key: returns `applied: false` if a row with the key exists
   * (or `points === 0`). The caller MUST hold the user lock (tx from
   * `withUserLock` for the same user).
   */
  async apply(tx: Tx, input: AwardInput): Promise<AwardResult> {
    this.assertLockHeld(tx, input.userId);
    if (!isValidAwardKey(input.key)) {
      throw new Error(`Invalid award key "${input.key}".`);
    }
    if (!Number.isSafeInteger(input.points)) {
      throw new Error('Award points must be an integer.');
    }

    const { ledger } = this.deps;
    if (input.points === 0 || (await ledger.hasKey(tx, input.userId, input.key))) {
      return {
        applied: false,
        historyId: null,
        pointsChange: 0,
        balance: await ledger.latestBalance(tx, input.userId),
      };
    }

    const previous = await ledger.latestBalance(tx, input.userId);
    const balance = previous + input.points;
    const historyId = await ledger.insert(tx, {
      userId: input.userId,
      pointsChange: input.points,
      pointsBalanceAfter: balance,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: formatAwardDescription(input.key, input.label),
    });

    return {
      applied: true,
      historyId,
      pointsChange: input.points,
      balance,
    };
  }

  /** True when the user already has a ledger row with this key (lock required). */
  async hasKey(tx: Tx, userId: number, key: string): Promise<boolean> {
    this.assertLockHeld(tx, userId);
    return this.deps.ledger.hasKey(tx, userId, key);
  }

  /** Current running balance (latest row), read under the lock for XP deltas. */
  async balance(tx: Tx, userId: number): Promise<number> {
    this.assertLockHeld(tx, userId);
    return this.deps.ledger.latestBalance(tx, userId);
  }

  /** One-off award (achievements, badges, admin adjustments): withUserLock + apply. */
  async applyLocked(input: AwardInput): Promise<AwardResult> {
    return this.withUserLock(input.userId, (tx) => this.apply(tx, input));
  }

  private assertLockHeld(tx: Tx, userId: number): void {
    const ctx = this.lockContext.getStore();
    if (!ctx || ctx.tx !== tx || ctx.userId !== userId) {
      throw new Error('Ledger writes require awardService.withUserLock for the same user and tx.');
    }
  }
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new NotFoundError('User not found.');
  }
}

export const awardService = new AwardService();
