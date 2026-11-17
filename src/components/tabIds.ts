import type { PlannerTab } from '../types'

/** DOM ids linking each tab button to the right-pane tab panel (WAI-ARIA tabs pattern). */
export const tabButtonId = (tab: PlannerTab) => `tab-${tab}`
export const tabPanelId = (tab: PlannerTab) => `tabpanel-${tab}`
