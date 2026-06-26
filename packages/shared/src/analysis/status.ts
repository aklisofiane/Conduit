import { z } from 'zod';

/**
 * User-facing analysis lifecycle on the connection. Persisted on
 * `RepoAnalysis.status` and owned by the workflow — independent of the
 * internal `RunStatus`, not a read-time derivation. Mirrors the
 * `RepoAnalysisStatus` Prisma enum.
 *
 *   PENDING   — row created, workflow not yet past clone
 *   ANALYZING — Discover / Design / Assemble in flight
 *   READY     — `resultBundle` populated; gallery can open
 *   FAILED    — `error` populated
 */
export const analysisStatusSchema = z.enum(['PENDING', 'ANALYZING', 'READY', 'FAILED']);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/**
 * Coarse progress signal for the connection's progress card. Persisted on
 * `RepoAnalysis.phase`, written by the workflow at each stage via the
 * `updateAnalysisPhase` activity so the card has a signal without reading
 * hidden `NodeRun` rows. Mirrors the `RepoAnalysisPhase` Prisma enum.
 */
export const analysisPhaseSchema = z.enum(['DISCOVER', 'DESIGN', 'ASSEMBLE']);
export type AnalysisPhase = z.infer<typeof analysisPhaseSchema>;
