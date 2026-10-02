import { defineErrors } from "../../core";

/** Доменные ошибки биометрии (`BIOMETRIC_*`). */
export const BiometricError = defineErrors("BIOMETRIC", {
  DEVICE_LIMIT: { status: 409, message: "Достигнут лимит устройств" },
  DEVICE_NOT_FOUND: { status: 404, message: "Устройство не найдено" },
  VERIFY_FAILED: {
    status: 401,
    message: "Биометрическая проверка не пройдена",
  },
});
