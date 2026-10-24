import { daysAgo } from './time';

// Shape: Dataset (section 5). Shared under /data/shared/, own under /data/mine/
export const datasets = [
  { id: 'ds_iris', name: 'iris.csv', description: 'Classic flower measurements', scope: 'shared', sizeBytes: 4551, rows: 150, courses: ['MCA-Python'], uploadedBy: 'usr_020', uploadedAt: daysAgo(50), mountPath: '/data/shared/iris.csv' },
  { id: 'ds_titanic', name: 'titanic.csv', description: 'Passenger survival data for cleaning practice', scope: 'shared', sizeBytes: 61194, rows: 891, courses: ['MCA-Python', 'MCA-DataScience'], uploadedBy: 'usr_020', uploadedAt: daysAgo(40), mountPath: '/data/shared/titanic.csv' },
  { id: 'ds_housing', name: 'housing.csv', description: 'California housing prices for regression', scope: 'shared', sizeBytes: 1423529, rows: 20640, courses: ['MCA-DataScience'], uploadedBy: 'usr_020', uploadedAt: daysAgo(20), mountPath: '/data/shared/housing.csv' },
  { id: 'ds_mine_1', name: 'sales_2025.csv', description: 'My mini project data', scope: 'mine', sizeBytes: 734003, rows: 12040, courses: [], uploadedBy: 'usr_101', uploadedAt: daysAgo(6), mountPath: '/data/mine/sales_2025.csv' },
];
