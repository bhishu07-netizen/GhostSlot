// Account roles as the UI shows them. The server (server/security.js) holds
// the authoritative lists and checks every permission; this file is copy only.
import { GraduationCap, Presentation, Wrench } from "lucide-react";

export const ROLE_META = {
  student: {
    label: "Student", icon: GraduationCap,
    idLabel: "student roll number", idExample: "23BCS10432",
    can: "Find and book free rooms · view the campus twin",
  },
  faculty: {
    label: "Faculty", icon: Presentation,
    idLabel: "employee ID", idExample: "E21045",
    deptLabel: "Department",
    departments: ["CSE", "AIT-CSE", "ECE", "Mechanical", "Civil", "Applied Sciences", "Management", "Other"],
    can: "Find and book rooms · view the campus twin",
  },
  facilities: {
    label: "Facilities", icon: Wrench,
    idLabel: "staff ID", idExample: "FMS2041",
    deptLabel: "Team",
    departments: ["Electrical", "Plumbing", "Housekeeping", "Estate office"],
    can: "Log energy & water readings · handle twin alerts",
  },
};
export const ROLE_ORDER = ["student", "faculty", "facilities"];
