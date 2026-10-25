import { Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/layout/DashboardLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Landing from './pages/public/Landing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import NotFound from './pages/public/NotFound';
// Student
import StudentOverview from './pages/student/Overview';
import Catalog from './pages/student/Catalog';
import MyLabs from './pages/student/MyLabs';
import Assignments from './pages/student/Assignments';
import Workspace from './pages/student/Workspace';
import Projects from './pages/student/Projects';
import StudentDatasets from './pages/student/Datasets';
import Usage from './pages/student/Usage';
// Faculty
import FacultyOverview from './pages/faculty/Overview';
import Students from './pages/faculty/Students';
import FacultyTemplates from './pages/faculty/Templates';
import Activities from './pages/faculty/Activities';
import FacultyDatasets from './pages/faculty/Datasets';
import UsageMonitor from './pages/faculty/UsageMonitor';
// Admin
import AdminOverview from './pages/admin/Overview';
import Infrastructure from './pages/admin/Infrastructure';
import Environments from './pages/admin/Environments';
import Users from './pages/admin/Users';
import AdminTemplates from './pages/admin/Templates';
import Policy from './pages/admin/Policy';
import Analytics from './pages/admin/Analytics';
import Settings from './pages/admin/Settings';

const guard = (roles, el) => <ProtectedRoute roles={roles}>{el}</ProtectedRoute>;

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Student: full-screen workspace sits outside the dashboard frame */}
      <Route path="/student/workspace/:id" element={guard(['student'], <Workspace />)} />
      <Route path="/student" element={guard(['student'], <DashboardLayout role="student" />)}>
        <Route index element={<StudentOverview />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="labs" element={<MyLabs />} />
        <Route path="projects" element={<Projects />} />
        <Route path="datasets" element={<StudentDatasets />} />
        <Route path="usage" element={<Usage />} />
      </Route>

      {/* Faculty: admins can read these pages too (contract section 4) */}
      <Route path="/faculty" element={guard(['faculty', 'admin'], <DashboardLayout role="faculty" />)}>
        <Route index element={<FacultyOverview />} />
        <Route path="students" element={<Students />} />
        <Route path="templates" element={<FacultyTemplates />} />
        <Route path="activities" element={<Activities />} />
        <Route path="datasets" element={<FacultyDatasets />} />
        <Route path="usage" element={<UsageMonitor />} />
      </Route>

      <Route path="/admin" element={guard(['admin'], <DashboardLayout role="admin" />)}>
        <Route index element={<AdminOverview />} />
        <Route path="infrastructure" element={<Infrastructure />} />
        <Route path="environments" element={<Environments />} />
        <Route path="users" element={<Users />} />
        <Route path="templates" element={<AdminTemplates />} />
        <Route path="policy" element={<Policy />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
