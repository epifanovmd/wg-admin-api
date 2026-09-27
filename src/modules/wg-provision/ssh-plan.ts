import { JobContext, JobError } from "../../core";
import { IProvisionStep, withSudo } from "./provision-plan";
import { SshRunner } from "./ssh-runner";

/**
 * Выполнить план по SSH с прогрессом и логом задачи: доля прогресса —
 * в диапазоне [from, to]; шаг с ненулевым кодом — ошибка задачи.
 */
export const runSshPlan = async (
  ctx: JobContext<unknown>,
  runner: Pick<SshRunner, "exec">,
  plan: IProvisionStep[],
  username: string,
  range: { from: number; to: number },
): Promise<void> => {
  for (const [index, step] of plan.entries()) {
    await ctx.progress(
      range.from + ((range.to - range.from) * index) / plan.length,
      step.title,
    );
    await ctx.log(`▶ ${step.title}`);

    // Вывод — в лог по мере выполнения: долгий шаг не выглядит зависшим.
    const logged: Promise<void>[] = [];
    const result = await runner.exec(
      withSudo(step.command, username),
      step.timeoutMs,
      line => {
        if (line.trim()) logged.push(ctx.log(line));
      },
    );

    await Promise.all(logged);
    if (result.code !== 0) {
      throw new JobError(
        "WG_PROVISION_STEP_FAILED",
        `${step.title}: код ${result.code}: ${result.stderr.slice(0, 500)}`,
        false,
      );
    }
  }
};
