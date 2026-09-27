import { inject, optional } from "inversify";

import {
  IJobHandler,
  Injectable,
  JobContext,
  JobDefinition,
  JobError,
  logger,
} from "../../core";
import { WgNodeService, WgSecretBox } from "../wg-node";
import { renderInstallScript } from "./install-script";
import { buildUninstallPlan, INSTALL_SCRIPT_PATH } from "./provision-plan";
import { runSshPlan } from "./ssh-plan";
import { SshRunner, SshRunnerFactory } from "./ssh-runner";
import { SSH_RUNNER_FACTORY } from "./wg-provision.job";
import { IWgUninstallJobData, WG_UNINSTALL_QUEUE } from "./wg-provision.types";

/**
 * Удаление агента с VPS: остановка с откатом созданного агентом, cleanup,
 * удаление контейнера и конфигурации. Успех — ключ агента отозван, нода
 * снова `created` (можно установить заново).
 */
@Injectable()
export class WgUninstallNodeJob implements IJobHandler<IWgUninstallJobData> {
  readonly definition: JobDefinition = {
    queue: WG_UNINSTALL_QUEUE,
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

  async handle(ctx: JobContext<IWgUninstallJobData>): Promise<void> {
    const data = ctx.data;
    const runner = this._sshFactory();

    try {
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

      // Бэкенд для удаления не нужен — адрес в установщике не используется.
      await runner.upload(
        INSTALL_SCRIPT_PATH,
        Buffer.from(renderInstallScript(""), "utf8"),
      );

      const plan = buildUninstallPlan();

      await runSshPlan(ctx, runner, plan, data.username, {
        from: 0.1,
        to: 0.9,
      });
      await this._nodes.detachAgent(data.nodeId, data.actorId);
      await ctx.progress(1, "Агент удалён");
    } catch (err) {
      logger.error({ err, nodeId: data.nodeId }, "[WG] uninstall failed");
      throw err instanceof JobError
        ? err
        : new JobError(
            "WG_UNINSTALL_FAILED",
            err instanceof Error ? err.message : String(err),
            false,
          );
    } finally {
      runner.end();
    }
  }
}
