import { Module } from "../../core";
import { BiometricController } from "./biometric.controller";
import { Biometric } from "./biometric.entity";
import { BiometricRepository } from "./biometric.repository";
import { BiometricService } from "./biometric.service";

@Module({
  entities: [Biometric],
  providers: [BiometricRepository, BiometricController, BiometricService],
})
export class BiometricModule {}
