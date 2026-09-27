import { Module } from "../decorators";
import { jobMetricsProvider } from "./job-metrics";

/**
 * Провайдеры наблюдаемости для DI: хук метрик задач `JOB_METRICS`.
 * Метрики HTTP и Sentry от DI не зависят (подключаются в `main.ts`
 * и `app.ts`).
 */
@Module({
  providers: [jobMetricsProvider],
})
export class ObservabilityModule {}
