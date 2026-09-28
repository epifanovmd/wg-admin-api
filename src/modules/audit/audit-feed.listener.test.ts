import "reflect-metadata";

import { expect } from "chai";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { AUDIT_ROOM, AuditFeedListener } from "./audit-feed.listener";
import { AuditRecordedEvent } from "./events";

describe("AuditFeedListener", () => {
  it("запись — в общий журнал и автору", () => {
    const eventBus = new EventBus();
    const emitter = createMockEmitter();
    const dto = { id: "a1", actorId: "u1" } as any;

    new AuditFeedListener(eventBus, emitter as any).register();
    eventBus.emit(new AuditRecordedEvent(dto));

    expect(emitter.toRoom.calledOnceWith(AUDIT_ROOM, "audit:created", dto)).to
      .be.true;
    expect(emitter.toUser.calledOnceWith("u1", "audit:created", dto)).to.be
      .true;
  });

  it("без автора — только общий журнал", () => {
    const eventBus = new EventBus();
    const emitter = createMockEmitter();

    new AuditFeedListener(eventBus, emitter as any).register();
    eventBus.emit(new AuditRecordedEvent({ id: "a1", actorId: null } as any));

    expect(emitter.toUser.called).to.be.false;
  });
});
