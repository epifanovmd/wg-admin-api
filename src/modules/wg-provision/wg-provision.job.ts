import { inject, optional } from "inversify";

import {
  IJobHandler,
  Injectable,
  JobContext,
  JobDefinition,
  JobError,
  logger,
} from "../../core";
import {
  EWgNodeStatus,
  WgNodeAgentService,
  WgNodeService,
  WgSecretBox,
} from "../wg-node";
import {
  buildProvisionPlan,
  isInsecureBackendUrl,
  workFiles,
} from "./provision-plan";
import { createWorkDir, removeWorkDir, runSshPlan } from "./ssh-plan";
import { SshRunner, SshRunnerFactory } from "./ssh-runner";
import { IWgProvisionJobData, WG_PROVISION_QUEUE } from "./wg-provision.types";

/** Фабрика SSH-соединений — подменяется в тестах. */
export const SSH_RUNNER_FACTORY = Symbol("SshRunnerFactory");

/**
 * Установка агента на VPS: команда установки с бэкенда (та же, что для
 * ручной установки) ставит агента службой systemd, воркеры wg и socks из
 * выпуска, пакеты и параметры ядра. Прогресс и лог — в записи задачи
 * (`track`); ноду к агенту привязывает его регистрация по токену с меткой
 * ноды, статус `online` — его выход на связь.
 */
@Injectable()
export class WgProvisionNodeJob implements IJobHandler<IWgProvisionJobData> {
  readonly definition: JobDefinition = {
    queue: WG_PROVISION_QUEUE,
    tracked: true,
    retryLimit: 0,
    concurrency: 2,
  };

  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeAgentService) private readonly _agents: WgNodeAgentService,
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
    @inject(SSH_RUNNER_FACTORY)
    @optional()
    private readonly _sshFactory: SshRunnerFactory = () => new SshRunner(),
  ) {}

  async handle(ctx: JobContext<IWgProvisionJobData>): Promise<void> {
    const data = ctx.data;
    const runner = this._sshFactory();
    let workDir: string | null = null;

    try {
      if (isInsecureBackendUrl(data.backendUrl)) {
        await ctx.log(
          `⚠ Агент будет ходить к бэкенду по http (${data.backendUrl}): ключ агента и приватные ключи — в открытом виде. Настройте HTTPS.`,
        );
      }
      await ctx.progress(0.05, "Подключение по SSH");
      await runner.connect({
        host: data.host,
        port: data.port,
        username: data.username,
        privateKey: data.privateKeyEnc
          ? this._secrets.open(data.privateKeyEnc)
          : undefined,
        password: data.passwordEnc
          ? this._secrets.open(data.passwordEnc)
          : undefined,
      });

      await ctx.progress(0.08, "Токен регистрации");
      workDir = await createWorkDir(runner);

      const files = workFiles(workDir);
      const node = await this._nodes.findEntity(data.nodeId);

      await runner.upload(
        files.token,
        Buffer.from(this._secrets.open(data.tokenEnc), "utf8"),
      );

      const plan = buildProvisionPlan(
        workDir,
        this._agents.commandFor(
          node,
          { tokenFile: files.token },
          data.backendUrl,
        ),
      );

      await runSshPlan(ctx, runner, plan, data.username, {
        from: 0.1,
        to: 0.95,
      });

      await ctx.progress(
        1,
        "Агент запущен, ждём регистрации и выхода на связь",
      );
    } catch (err) {
      logger.error({ err, nodeId: data.nodeId }, "[WG] provision failed");
      await this._agents.revokeToken(data.tokenId);
      await this._nodes.setStatus(data.nodeId, EWgNodeStatus.Error);
      throw err instanceof JobError
        ? err
        : new JobError(
            "WG_PROVISION_FAILED",
            err instanceof Error ? err.message : String(err),
            false,
          );
    } finally {
      if (workDir) await removeWorkDir(runner, workDir);
      runner.end();
    }
  }
}
