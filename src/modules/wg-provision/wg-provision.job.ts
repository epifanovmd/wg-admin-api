import { inject, optional } from "inversify";

import {
  IJobHandler,
  Injectable,
  JobContext,
  JobDefinition,
  JobError,
  logger,
} from "../../core";
import { EWgNodeStatus, WgNodeService, WgSecretBox } from "../wg-node";
import { renderInstallScript } from "./install-script";
import {
  buildProvisionPlan,
  INSTALL_SCRIPT_PATH,
  isInsecureBackendUrl,
} from "./provision-plan";
import { runSshPlan } from "./ssh-plan";
import { SshRunner, SshRunnerFactory } from "./ssh-runner";
import { IWgProvisionJobData, WG_PROVISION_QUEUE } from "./wg-provision.types";

/** Фабрика SSH-соединений — подменяется в тестах. */
export const SSH_RUNNER_FACTORY = Symbol("SshRunnerFactory");

/**
 * Установка агента на VPS: установщик (он же — для ручной установки)
 * ставит зависимости, скачивает бинарь агента с бэкенда по ключу и включает
 * службу systemd. Прогресс и лог — в записи задачи (`track`), финальный
 * статус ноды подтверждает сам агент, выйдя на связь.
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
    @inject(WgSecretBox) private readonly _secrets: WgSecretBox,
    @inject(SSH_RUNNER_FACTORY)
    @optional()
    private readonly _sshFactory: SshRunnerFactory = () => new SshRunner(),
  ) {}

  async handle(ctx: JobContext<IWgProvisionJobData>): Promise<void> {
    const data = ctx.data;
    const runner = this._sshFactory();

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

      await ctx.progress(0.08, "Загрузка установщика");
      await runner.upload(
        INSTALL_SCRIPT_PATH,
        Buffer.from(renderInstallScript(data.backendUrl), "utf8"),
      );

      const plan = buildProvisionPlan({
        agentKey: this._secrets.open(data.agentKeyEnc),
      });

      await runSshPlan(ctx, runner, plan, data.username, {
        from: 0.1,
        to: 0.95,
      });

      await ctx.progress(1, "Агент запущен, ждём выхода на связь");
    } catch (err) {
      logger.error({ err, nodeId: data.nodeId }, "[WG] provision failed");
      await this._nodes.setStatus(data.nodeId, EWgNodeStatus.Error);
      throw err instanceof JobError
        ? err
        : new JobError(
            "WG_PROVISION_FAILED",
            err instanceof Error ? err.message : String(err),
            false,
          );
    } finally {
      runner.end();
    }
  }
}
