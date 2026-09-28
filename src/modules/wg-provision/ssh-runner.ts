import { StringDecoder } from "node:string_decoder";

import { Client, ConnectConfig } from "ssh2";

export interface ISshCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Тонкая обёртка над ssh2: последовательные команды в одном соединении.
 * Выделена интерфейсом, чтобы job подменял её в тестах.
 */
export class SshRunner {
  private readonly _client = new Client();

  connect(config: ConnectConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this._client
        .once("ready", () => resolve())
        .once("error", reject)
        .connect({ readyTimeout: 15_000, ...config });
    });
  }

  /** Выполнить команду; `onLine` получает строки stdout по мере поступления. */
  exec(
    command: string,
    timeoutMs = 300_000,
    onLine?: (line: string) => void,
  ): Promise<ISshCommandResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSH-команда не уложилась в ${timeoutMs} мс`));
      }, timeoutMs);

      this._client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);

          return;
        }

        let stdout = "";
        let stderr = "";
        let pending = "";
        const decoder = new StringDecoder("utf8");

        stream
          .on("data", (chunk: Buffer) => {
            const text = decoder.write(chunk);

            stdout += text;
            if (!onLine) return;

            const lines = (pending + text).split("\n");

            pending = lines.pop() ?? "";
            lines.forEach(onLine);
          })
          .stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (onLine && pending) onLine(pending);
          resolve({ code: code ?? -1, stdout, stderr });
        });
      });
    });
  }

  /** Записать файл на хост (каталоги создаются); путь — без пробелов и кавычек. */
  upload(
    remotePath: string,
    content: Buffer,
    timeoutMs = 60_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // umask 077: файл (установщик, ключ агента) читает только владелец.
      const command = `umask 077 && mkdir -p "$(dirname '${remotePath}')" && cat > '${remotePath}'`;
      const timer = setTimeout(() => {
        reject(
          new Error(`Загрузка ${remotePath} не уложилась в ${timeoutMs} мс`),
        );
      }, timeoutMs);

      this._client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);

          return;
        }

        let stderr = "";

        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        // ssh2 шлёт `close` только после `end` stdout — поток нужно читать.
        stream.resume();
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else
            reject(new Error(`Загрузка ${remotePath}: код ${code} ${stderr}`));
        });
        stream.end(content);
      });
    });
  }

  end(): void {
    this._client.end();
  }
}

export type SshRunnerFactory = () => SshRunner;
