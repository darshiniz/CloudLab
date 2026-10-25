import { ago, fromNow } from './time';

// Shape: Activity (section 5). assignTo.type is "class" or "students".
export const activities = [
  { id: 'act_7', title: 'Pandas basics', description: 'Clean and summarise the titanic dataset', labId: 'lab_python', datasetId: 'ds_titanic', dueDate: fromNow(60 * 24 * 4), assignTo: { type: 'class', studentIds: [] }, progress: { assigned: 12, inProgress: 5, completed: 3 }, createdBy: 'usr_020', createdAt: ago(60 * 24 * 3) },
  { id: 'act_6', title: 'Bank account OOP', description: 'Implement Account and Bank classes with deposit/withdraw', labId: 'lab_java', datasetId: null, dueDate: fromNow(60 * 24 * 1), assignTo: { type: 'class', studentIds: [] }, progress: { assigned: 12, inProgress: 2, completed: 8 }, createdBy: 'usr_020', createdAt: ago(60 * 24 * 8) },
  { id: 'act_5', title: 'Portfolio landing page', description: 'Build a responsive landing page and deploy it locally', labId: 'lab_web', datasetId: null, dueDate: ago(60 * 24 * 2), assignTo: { type: 'students', studentIds: ['usr_101', 'usr_104', 'usr_107'] }, progress: { assigned: 3, inProgress: 0, completed: 3 }, createdBy: 'usr_020', createdAt: ago(60 * 24 * 12) },
];
