import { z } from "zod";

const interfaceStatus = z.object({
  name: z.string().max(15),
  status: z.enum(["up", "down", "error", "unknown"]),
  message: z.string().max(2000).nullable().optional(),
});

export const WgAgentReportSchema = z.object({
  appliedVersion: z.number().int().nonnegative().optional(),
  applyError: z.string().max(4000).nullable().optional(),
  agentVersion: z.string().max(32).optional(),
  wgVersion: z.string().max(64).nullable().optional(),
  codeHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  os: z
    .object({
      platform: z.string().max(64).optional(),
      release: z.string().max(128).optional(),
      distro: z.string().max(128).optional(),
      arch: z.string().max(32).optional(),
      hostname: z.string().max(255).optional(),
      kernel: z.string().max(128).optional(),
      wgMode: z.enum(["kernel", "userspace"]).optional(),
      udpPorts: z
        .array(z.number().int().min(1).max(65535))
        .max(1000)
        .optional(),
      tcpPorts: z
        .array(z.number().int().min(1).max(65535))
        .max(1000)
        .optional(),
    })
    .optional(),
  interfaces: z.array(interfaceStatus).max(100).optional(),
});

const peerStat = z.object({
  publicKey: z.string().max(64),
  rxBytes: z.number().nonnegative(),
  txBytes: z.number().nonnegative(),
  lastHandshake: z.number().nullable(),
  endpoint: z.string().max(64).nullable(),
});

export const WgAgentStatsSchema = z.object({
  seq: z.number().int().nonnegative().optional(),
  bootId: z.string().min(1).max(64).optional(),
  collectedAt: z.number().int().positive().optional(),
  sentAt: z.number().int().positive().optional(),
  sys: z
    .object({
      cpuPercent: z.number().min(0).max(100),
      load1: z.number().nonnegative(),
      load5: z.number().nonnegative().optional(),
      load15: z.number().nonnegative().optional(),
      nics: z
        .array(
          z.object({
            name: z.string().max(15),
            rxBps: z.number().nonnegative(),
            txBps: z.number().nonnegative(),
          }),
        )
        .max(50)
        .optional(),
      conntrackCount: z.number().int().nonnegative().nullable().optional(),
      conntrackMax: z.number().int().nonnegative().nullable().optional(),
      memUsedBytes: z.number().nonnegative(),
      memTotalBytes: z.number().nonnegative(),
      diskUsedBytes: z.number().nonnegative(),
      diskTotalBytes: z.number().nonnegative(),
      uptimeSec: z.number().nonnegative(),
    })
    .optional(),
  tunnels: z
    .array(
      z.object({
        name: z.string().max(15),
        rttMs: z.number().nonnegative().nullable(),
        lossPercent: z.number().min(0).max(100),
        mtuOk: z.boolean().nullable().optional(),
      }),
    )
    .max(200)
    .optional(),
  forwards: z
    .array(
      z.object({
        id: z.uuid(),
        activeRoute: z.enum(["tunnel", "direct"]),
        activeCandidate: z.number().int().nonnegative().optional(),
        activeNodeId: z.uuid().optional(),
      }),
    )
    .max(500)
    .optional(),
  socks: z
    .array(
      z.object({
        id: z.uuid(),
        connections: z.number().int().nonnegative(),
        rxBytes: z.number().nonnegative(),
        txBytes: z.number().nonnegative(),
      }),
    )
    .max(100)
    .optional(),
  nodeProbes: z
    .array(
      z.object({
        nodeId: z.uuid(),
        rttMs: z.number().nonnegative().nullable(),
        lossPercent: z.number().min(0).max(100),
      }),
    )
    .max(100)
    .optional(),
  interfaces: z
    .array(
      z.object({
        name: z.string().max(15),
        peers: z.array(peerStat).max(10_000),
      }),
    )
    .max(100),
});

export const WgAgentCommandOutputSchema = z.object({
  chunk: z.string().max(16 * 1024),
});

export const WgAgentCommandCompleteSchema = z.object({
  exitCode: z.number().int().min(-255).max(255).nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
});
