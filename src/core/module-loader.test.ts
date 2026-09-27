import "reflect-metadata";

import { expect } from "chai";
import { Container } from "inversify";
import { Controller } from "tsoa";

import { Module } from "./decorators";
import { ModuleLoader } from "./module-loader";

class CounterService {
  calls = 0;
}

class DownloadController extends Controller {
  download(): string {
    this.setHeader("Content-Length", "18");

    return "binary";
  }
}

@Module({ providers: [CounterService, DownloadController] })
class TestModule {}

describe("ModuleLoader", () => {
  it("контроллер — новый экземпляр на запрос: заголовки ответа не протекают в следующий", () => {
    const container = new Container();

    new ModuleLoader(container).load(TestModule);

    const first = container.get(DownloadController);

    first.download();
    expect(first.getHeaders()).to.deep.include({ "Content-Length": "18" });

    // Прежде контроллер был синглтоном: Content-Length ответа с бинарём
    // обрезал следующий ответ того же контроллера (install.sh).
    const second = container.get(DownloadController);

    expect(second).to.not.equal(first);
    expect(second.getHeaders()).to.deep.equal({});
  });

  it("сервисы — синглтоны", () => {
    const container = new Container();

    new ModuleLoader(container).load(TestModule);

    expect(container.get(CounterService)).to.equal(
      container.get(CounterService),
    );
  });
});
