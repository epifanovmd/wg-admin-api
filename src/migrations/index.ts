import { InitialSchema1790353961289 } from "./1790353961289-InitialSchema";
import { JobRunStop1790357606328 } from "./1790357606328-JobRunStop";
import { FileOwnerSetNull1790358900018 } from "./1790358900018-FileOwnerSetNull";
import { JobWorkers1790363180288 } from "./1790363180288-JobWorkers";
import { CreateWireguard1790436553205 } from "./1790436553205-CreateWireguard";
import { RemoveNonWgFeatures1790446979860 } from "./1790446979860-RemoveNonWgFeatures";
import { WgNodeChangedNotify1790500000000 } from "./1790500000000-WgNodeChangedNotify";
import { WgNodeAgentRemoteIp1790500000001 } from "./1790500000001-WgNodeAgentRemoteIp";
import { WgNodeAgentCodeHash1790500000002 } from "./1790500000002-WgNodeAgentCodeHash";
import { CreateWgForward1790500000003 } from "./1790500000003-CreateWgForward";
import { WgInterfaceReplicas1790500000004 } from "./1790500000004-WgInterfaceReplicas";
import { WgInterfaceServingNode1790500000005 } from "./1790500000005-WgInterfaceServingNode";
import { CreateWgSocks1790500000006 } from "./1790500000006-CreateWgSocks";
import { RemoveWgNodeShell1790531351794 } from "./1790531351794-RemoveWgNodeShell";
import { WgSocksKeysRequired1790534923076 } from "./1790534923076-WgSocksKeysRequired";
import { JobRunRemoveExternalFields1790538047331 } from "./1790538047331-JobRunRemoveExternalFields";
import { SplitManagePermissions1790600000000 } from "./1790600000000-SplitManagePermissions";

/**
 * Миграции в порядке применения. Новая миграция: `yarn migration:generate
 * src/migrations/<Name>` → добавить класс сюда. Применённые миграции не
 * редактируются — изменение схемы = новая миграция.
 */
export const migrations: Function[] = [
  InitialSchema1790353961289,
  JobRunStop1790357606328,
  FileOwnerSetNull1790358900018,
  JobWorkers1790363180288,
  CreateWireguard1790436553205,
  RemoveNonWgFeatures1790446979860,
  WgNodeChangedNotify1790500000000,
  WgNodeAgentRemoteIp1790500000001,
  WgNodeAgentCodeHash1790500000002,
  CreateWgForward1790500000003,
  WgInterfaceReplicas1790500000004,
  WgInterfaceServingNode1790500000005,
  CreateWgSocks1790500000006,
  RemoveWgNodeShell1790531351794,
  WgSocksKeysRequired1790534923076,
  JobRunRemoveExternalFields1790538047331,
  SplitManagePermissions1790600000000,
];
