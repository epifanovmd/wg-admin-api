import {
  Injectable,
  openSecret,
  parseSecretBoxKey,
  sealSecret,
} from "../../core";
import { wgConfig } from "./wg.config";

/**
 * Шифрование секретов WG-домена (приватные ключи, PSK, SSH-ключи) перед
 * записью в БД. Ключ — `WG_SECRETS_KEY`; ошибка формата валит старт процесса.
 */
@Injectable()
export class WgSecretBox {
  private readonly _key = parseSecretBoxKey(wgConfig.secretsKey);

  seal(plain: string): string {
    return sealSecret(plain, this._key);
  }

  open(sealed: string): string {
    return openSecret(sealed, this._key);
  }
}
