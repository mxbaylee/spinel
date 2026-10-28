import type { MaintenancePublicStatus } from '../../shared/maintenance.ts';

// Opt in from unrelated network/controller tests. Keep maintenance tests on
// the production store, and do not consume their controlled response queues.
const status: MaintenancePublicStatus = Object.freeze({
  available: false,
  phase: 'running',
  epoch: '',
  notice: null,
});

export const maintenanceEvent = 'spinel-maintenance';
export const getMaintenanceStatus = () => status;
export const getMaintenanceEpoch = () => undefined;
export const refreshMaintenanceStatus = async () => status;
