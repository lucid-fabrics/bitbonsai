// Re-export from core to maintain backwards compatibility with existing consumers.
// The canonical definition lives in core/models/overview.model.ts.
export type {
  NodeStatusModel,
  OverviewModel,
  QueueSummaryModel,
  RecentActivityModel,
  SystemHealthModel,
  TopLibraryModel,
} from '../../../core/models/overview.model';
