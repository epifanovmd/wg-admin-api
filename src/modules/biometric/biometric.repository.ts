import { DeleteResult, MoreThan } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { Biometric } from "./biometric.entity";

@InjectableRepository(Biometric)
export class BiometricRepository extends BaseRepository<Biometric> {
  async findById(id: string): Promise<Biometric | null> {
    return this.findOne({
      where: { id },
      relations: { user: true },
    });
  }

  async findByUserId(userId: string): Promise<Biometric[]> {
    return this.find({
      where: { userId },
    });
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<Biometric | null> {
    return this.findOne({
      where: {
        userId,
        deviceId,
      },
    });
  }

  async countByUserId(userId: string): Promise<number> {
    return this.count({ where: { userId } });
  }

  /**
   * Атомарно погасить nonce: только если он совпадает и не истёк.
   * `false` — nonce чужой, истёк или уже использован.
   */
  async consumeChallenge(id: string, nonce: string): Promise<boolean> {
    const { affected } = await this.update(
      { id, challenge: nonce, challengeExpiresAt: MoreThan(new Date()) },
      { challenge: null, challengeExpiresAt: null },
    );

    return affected === 1;
  }

  async deleteByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<DeleteResult> {
    return this.delete({ userId, deviceId });
  }
}
