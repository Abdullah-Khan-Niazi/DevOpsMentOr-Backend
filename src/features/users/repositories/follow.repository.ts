import { and, count, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { userFollows } from '../../../app/database/schema';

export interface IFollowRepository {
  exists(followerId: number, followingId: number): Promise<boolean>;
  add(followerId: number, followingId: number): Promise<void>;
  remove(followerId: number, followingId: number): Promise<void>;
  countFollowers(userId: number): Promise<number>;
  countFollowing(userId: number): Promise<number>;
}

export class FollowRepository implements IFollowRepository {
  async exists(followerId: number, followingId: number): Promise<boolean> {
    const rows = await db
      .select({ value: count() })
      .from(userFollows)
      .where(
        and(eq(userFollows.followerId, followerId), eq(userFollows.followingId, followingId)),
      );
    return (rows[0]?.value ?? 0) > 0;
  }

  async add(followerId: number, followingId: number): Promise<void> {
    await db.insert(userFollows).values({ followerId, followingId });
  }

  async remove(followerId: number, followingId: number): Promise<void> {
    await db
      .delete(userFollows)
      .where(
        and(eq(userFollows.followerId, followerId), eq(userFollows.followingId, followingId)),
      );
  }

  async countFollowers(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userFollows)
      .where(eq(userFollows.followingId, userId));
    return rows[0]?.value ?? 0;
  }

  async countFollowing(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userFollows)
      .where(eq(userFollows.followerId, userId));
    return rows[0]?.value ?? 0;
  }
}

export const followRepository = new FollowRepository();