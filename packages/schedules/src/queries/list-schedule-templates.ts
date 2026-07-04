// Core op — return the built-in schedule template catalog. sync, pure.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import {
  SCHEDULE_TEMPLATE_CATALOG,
  type ScheduleTemplateDefinition,
} from '@vynel/contracts/schedules/schedule-template-catalog'

export function listScheduleTemplates(): readonly ScheduleTemplateDefinition[] {
  return SCHEDULE_TEMPLATE_CATALOG
}
