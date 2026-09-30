/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Server health check
 *     description: Public endpoint to verify that the server is online and operational. Suitable for uptime monitors, load balancers, and external cron jobs to prevent server sleep / cold starts.
 *     responses:
 *       200:
 *         description: Server is online and healthy.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Service is healthy.
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: ok
 *                     uptime:
 *                       type: number
 *                       example: 120
 *                     timestamp:
 *                       type: string
 *                       example: "2026-09-30T17:55:00.000Z"
 *                     environment:
 *                       type: string
 *                       example: production
 * /ping:
 *   get:
 *     tags: [Health]
 *     summary: Lightweight ping check
 *     description: Fast, zero-overhead ping-pong endpoint for external cron jobs and uptime heartbeats.
 *     responses:
 *       200:
 *         description: Server responded with pong.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: pong
 */
export {};
