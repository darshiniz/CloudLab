import { ago } from './time';

// Shape: Project and FileItem (section 5)
export const projects = [
  { id: 'prj_20', userId: 'usr_101', name: 'Sales Analysis', labType: 'python', createdAt: ago(60 * 24 * 21), modifiedAt: ago(60 * 17) },
  { id: 'prj_21', userId: 'usr_101', name: 'Bank Account System', labType: 'java', createdAt: ago(60 * 24 * 14), modifiedAt: ago(60 * 2) },
  { id: 'prj_22', userId: 'usr_101', name: 'Portfolio Site', labType: 'web', createdAt: ago(60 * 24 * 9), modifiedAt: ago(60 * 25) },
];

const f = (path, sizeBytes, minAgo) => ({ name: path.split('/').pop(), path, type: 'file', sizeBytes, modifiedAt: ago(minAgo) });
const d = (path, minAgo) => ({ name: path.split('/').pop(), path, type: 'folder', sizeBytes: 0, modifiedAt: ago(minAgo) });

// Flat list per project; the mock backend filters by parent path
export const files = {
  prj_20: [
    d('/src', 1020), d('/data', 2000), d('/notebooks', 900),
    f('/README.md', 812, 3000),
    f('/requirements.txt', 96, 3000),
    f('/src/analysis.py', 2048, 1020),
    f('/src/clean.py', 1544, 1100),
    f('/data/sales_2025.csv', 734003, 2000),
    f('/notebooks/explore.ipynb', 48211, 900),
  ],
  prj_21: [
    d('/src', 120), f('/pom.xml', 1733, 4000),
    f('/src/Account.java', 2911, 120), f('/src/Bank.java', 3420, 130), f('/src/Main.java', 870, 140),
  ],
  prj_22: [
    d('/css', 1500), d('/js', 1500), f('/index.html', 4096, 1500), f('/package.json', 402, 1600),
    f('/css/style.css', 6210, 1500), f('/js/app.js', 3012, 1510),
  ],
};
