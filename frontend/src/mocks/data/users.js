import { ago, daysAgo } from './time';

// Shape: User (section 5). rollNo is null for faculty and admin.
// `password` exists ONLY in the mock backend and is never returned by any endpoint.
const student = (n, name, rollNo, lastActiveMin, status = 'active') => ({
  id: `usr_${n}`,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@gbs.edu`,
  role: 'student',
  status,
  rollNo,
  createdAt: daysAgo(80),
  lastActiveAt: ago(lastActiveMin),
  password: 'student123',
});

export const users = [
  student(101, 'Anushka Marcelo', '25P0320011', 3),
  student(102, 'Darshini Zoraunkar', '25P0320012', 12),
  student(103, 'Riya Naik', '25P0320013', 5),
  student(104, 'Priya Desai', '25P0320014', 2),
  student(105, 'Sneha Kamat', '25P0320015', 7),
  student(106, 'Kavya Shetty', '25P0320016', 1),
  student(107, 'Meera Gaonkar', '25P0320017', 9),
  student(108, 'Aditi Prabhu', '25P0320018', 0),
  student(109, 'Fatima Shaikh', '25P0320019', 0),
  student(110, 'Rhea Verenkar', '25P0320020', 60 * 26),
  student(111, 'Nikita Borkar', '25P0320021', 60 * 50),
  student(112, 'Vaishnavi Kerkar', '25P0320022', 60 * 24 * 9, 'inactive'),
  {
    id: 'usr_020', name: 'Dr. Sonia Fernandes', email: 'sonia@gbs.edu', role: 'faculty', status: 'active',
    rollNo: null, createdAt: daysAgo(120), lastActiveAt: ago(30), password: 'faculty123',
  },
  {
    id: 'usr_001', name: 'Lab Admin', email: 'admin@gbs.edu', role: 'admin', status: 'active',
    rollNo: null, createdAt: daysAgo(150), lastActiveAt: ago(4), password: 'admin123',
  },
];
