import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { journeySchema, type Journey } from "./journey.js";
import type { TokenUsage } from "./gateway.js";
import type { Run } from "./runner.js";

export type RevisionStatus =
  | "ACTIVE"
  | "PROVISIONAL"
  | "SUPERSEDED"
  | "REJECTED";

export type LearningUsage = {
  callsCount: number;
  tokens: TokenUsage;
  costUsd: number;
  durationMs: number;
};

export type JourneyRevision = {
  revisionId: string;
  journeyId: string;
  version: number;
  status: RevisionStatus;
  source: "hand-authored" | "generated";
  createdAt: string;
  activatedAt?: string;
  journey: Journey;
  appId: string;
  environment: string;
  contextVersion: string;
  goal: string;
  acceptanceCriteria: string[];
  learningUsage?: LearningUsage;
  validationRunId?: string;
};

export class JourneyStore {
  private memoryDir: string;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? join(process.cwd(), "memory");
  }

  private revisionsDir(): string {
    return join(this.memoryDir, "revisions");
  }

  private journeysDir(): string {
    return join(this.memoryDir, "journeys");
  }

  private safeId(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid journey or revision ID");
    return id;
  }

  async init(): Promise<void> {
    await mkdir(this.revisionsDir(), { recursive: true });
    await mkdir(this.journeysDir(), { recursive: true });
  }

  async saveProvisionalRevision(params: {
    journeyId: string;
    journey: Journey;
    appId: string;
    environment: string;
    contextVersion: string;
    goal: string;
    acceptanceCriteria: string[];
    learningUsage?: LearningUsage;
  }): Promise<JourneyRevision> {
    await this.init();
    this.safeId(params.journeyId);
    const existing = await this.getRevisions(params.journeyId);
    const version = existing.length + 1;
    const revisionId = `rev-${params.journeyId}-v${version}-${randomUUID()}`;

    const revision: JourneyRevision = {
      revisionId,
      journeyId: params.journeyId,
      version,
      status: "PROVISIONAL",
      source: "generated",
      createdAt: new Date().toISOString(),
      journey: params.journey,
      appId: params.appId,
      environment: params.environment,
      contextVersion: params.contextVersion,
      goal: params.goal,
      acceptanceCriteria: params.acceptanceCriteria,
      learningUsage: params.learningUsage,
    };

    const filePath = join(this.revisionsDir(), `${revisionId}.json`);
    await writeFile(filePath, JSON.stringify(revision, null, 2), { encoding: "utf8", flag: "wx" });
    return revision;
  }

  async activateRevision(
    revisionId: string,
    validationRun: Run,
  ): Promise<JourneyRevision> {
    await this.init();
    const revision = await this.getRevision(revisionId);
    if (!revision) {
      throw new Error(`Revision ${revisionId} not found`);
    }
    if (revision.status !== "PROVISIONAL" || validationRun.status !== "PASS" ||
        !validationRun.evidence || validationRun.modelCalls !== 0 ||
        validationRun.source !== "generated" || validationRun.journey !== revision.journey.name ||
        validationRun.steps.length !== revision.journey.steps.length + 1 ||
        validationRun.steps.some((step) => step.status !== "PASS") ||
        validationRun.steps.at(-1)?.label !== "Verify the business outcome")
      throw new Error("Only a validated provisional revision can be activated");

    revision.status = "ACTIVE";
    revision.activatedAt = new Date().toISOString();
    revision.validationRunId = validationRun.id;

    await writeFile(
      join(this.revisionsDir(), `${revision.revisionId}.json`),
      JSON.stringify(revision, null, 2),
      "utf8",
    );

    // Save active pointer
    const activePointerPath = join(
      this.journeysDir(),
      `${revision.journeyId}.json`,
    );
    await writeFile(
      activePointerPath,
      JSON.stringify(
        {
          journeyId: revision.journeyId,
          activeRevisionId: revision.revisionId,
          appId: revision.appId,
          environment: revision.environment,
          contextVersion: revision.contextVersion,
          updatedAt: revision.activatedAt,
        },
        null,
        2,
      ),
      "utf8",
    );

    return revision;
  }

  async rejectRevision(
    revisionId: string,
    _reason?: string,
  ): Promise<JourneyRevision> {
    await this.init();
    const revision = await this.getRevision(revisionId);
    if (!revision) {
      throw new Error(`Revision ${revisionId} not found`);
    }
    if (revision.status !== "PROVISIONAL")
      throw new Error("Only a provisional revision can be rejected");
    revision.status = "REJECTED";
    await writeFile(
      join(this.revisionsDir(), `${revision.revisionId}.json`),
      JSON.stringify(revision, null, 2),
      "utf8",
    );
    return revision;
  }

  async getRevision(revisionId: string): Promise<JourneyRevision | null> {
    this.safeId(revisionId);
    try {
      const data = await readFile(
        join(this.revisionsDir(), `${revisionId}.json`),
        "utf8",
      );
      const revision = JSON.parse(data) as JourneyRevision;
      if (revision.revisionId !== revisionId || !journeySchema.safeParse(revision.journey).success)
        throw new Error("Stored journey revision is invalid");
      return revision;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getActiveRevision(journeyId: string, scope?: {
    appId: string; environment: string; contextVersion: string;
  }): Promise<JourneyRevision | null> {
    this.safeId(journeyId);
    try {
      const pointer = JSON.parse(
        await readFile(join(this.journeysDir(), `${journeyId}.json`), "utf8"),
      );
      if (pointer?.journeyId !== journeyId || typeof pointer.activeRevisionId !== "string")
        throw new Error("Active journey pointer is invalid");
      const revision = await this.getRevision(pointer.activeRevisionId);
      if (!revision || revision.status !== "ACTIVE" || revision.source !== "generated" ||
          !revision.validationRunId || !revision.activatedAt || revision.journeyId !== journeyId ||
          revision.appId !== pointer.appId || revision.environment !== pointer.environment ||
          revision.contextVersion !== pointer.contextVersion ||
          (scope && (revision.appId !== scope.appId || revision.environment !== scope.environment ||
            revision.contextVersion !== scope.contextVersion)))
        return null;
      return revision;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return null;
  }

  async getRevisions(journeyId?: string): Promise<JourneyRevision[]> {
    if (journeyId) this.safeId(journeyId);
    try {
      const files = await readdir(this.revisionsDir());
      const revisions: JourneyRevision[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const rev = await this.getRevision(file.slice(0, -5));
        if (rev && (!journeyId || rev.journeyId === journeyId)) revisions.push(rev);
      }
      if (journeyId) {
        const activeId = (await this.getActiveRevision(journeyId))?.revisionId;
        for (const revision of revisions)
          if (revision.status === "ACTIVE" && revision.revisionId !== activeId)
            revision.status = "SUPERSEDED";
      }
      return revisions.sort((a, b) => b.version - a.version);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
