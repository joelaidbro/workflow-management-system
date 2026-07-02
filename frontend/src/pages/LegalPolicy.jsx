import { Link } from "react-router-dom";

function LegalPolicy() {
  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Back to Login Link */}
        <div className="mb-8">
          <Link
            to="/login"
            className="inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline"
          >
            ← Back to Login
          </Link>
        </div>

        {/* Header */}
        <header className="mb-12 border-b border-gray-200 pb-8 text-center sm:text-left">
          <div className="text-3xl font-extrabold text-blue-950">WorkFlow</div>
          <h1 className="mt-2 text-4xl font-bold text-gray-900 tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:gap-4 text-sm text-gray-500">
            <span>Last updated: June 2026</span>
            <span className="hidden sm:inline">|</span>
            <span>Operated by AidBro</span>
          </div>
        </header>

        <div className="space-y-10 text-gray-700 leading-relaxed">
          {/* Section 1 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              1. Introduction
            </h2>
            <p>
              WorkFlow is a staff monitoring and communication platform operated by AidBro for internal business use. This policy outlines how we collect, use, and protect your information when you use the WorkFlow services and desktop monitoring agent.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              2. What Data We Collect
            </h2>
            <p className="mb-3">
              To operate the platform effectively and ensure accurate workplace metrics, we collect the following types of information:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account Information:</strong> name, email, employee ID, department, phone
              </li>
              <li>
                <strong>Work Activity:</strong> login/logout times, active/idle status, break and meeting times
              </li>
              <li>
                <strong>Daily Reports:</strong> work summaries and logs submitted directly by staff
              </li>
              <li>
                <strong>Chat Messages:</strong> communications sent between staff and management through the internal messaging system
              </li>
              <li>
                <strong>Alert Messages:</strong> notifications, admin announcements, and replies sent or received
              </li>
              <li>
                <strong>Attendance and Leave Records:</strong> logs of days worked, requests, and approvals
              </li>
              <li>
                <strong>Screenshots:</strong> captures of the staff member's desktop screen taken every 10 minutes during active work hours
              </li>
              <li>
                <strong>Device Information:</strong> the unique machine ID of the registered work computer running the desktop agent
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              3. How We Use This Data
            </h2>
            <p className="mb-3">
              Collected data is processed strictly for legitimate operational and business purposes, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>To monitor staff attendance and work activity for payroll accuracy</li>
              <li>To calculate salary and compensation based on days present and active</li>
              <li>To enable secure internal communication between staff and management</li>
              <li>To maintain audit logs and history for HR and management reviews</li>
              <li>To detect idle time and ensure accurate tracking of working hours</li>
            </ul>
          </section>

          {/* Section 4 - Screenshot Monitoring (Prominent Light Yellow Warning Style) */}
          <section className="rounded-2xl border border-yellow-200 bg-yellow-50/70 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="text-3xl" role="img" aria-label="warning">
                ⚠️
              </span>
              <div>
                <h2 className="text-2xl font-bold text-yellow-900 mb-3">
                  4. Screenshot Monitoring
                </h2>
                <p className="mb-4 text-yellow-950 font-medium">
                  Please review the screenshot capture policies carefully. By using this system, staff acknowledge and consent to screenshot monitoring:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-yellow-900">
                  <li>Screenshots are captured automatically every 10 minutes during active working hours only.</li>
                  <li>No screenshots are captured during breaks, meetings, idle time, or outside of active working hours.</li>
                  <li>Screenshots are retained for 48 hours, after which they are permanently deleted from the system.</li>
                  <li>Screenshots are restricted and accessible only to the company's designated super administrator.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              5. Data Retention
            </h2>
            <p className="mb-3">
              We apply strict retention schedules to ensure data is only kept for as long as necessary:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Activity Logs:</strong> 6 months (configurable by company settings)
              </li>
              <li>
                <strong>Chat Messages:</strong> 6 months (configurable by company settings)
              </li>
              <li>
                <strong>Attendance Records:</strong> Kept permanently for historical payroll and legal records
              </li>
              <li>
                <strong>Screenshots:</strong> 48 hours only, then permanently and irrecoverably deleted
              </li>
              <li>
                <strong>Daily Reports:</strong> 6 months (configurable by company settings)
              </li>
            </ul>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              6. Data Access
            </h2>
            <p className="mb-3">
              Access permissions are strictly governed by role-based controls:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Staff:</strong> Can view their own attendance, reports, alerts, and leave records.</li>
              <li><strong>Admins:</strong> Can view assigned team members' work activities and daily reports.</li>
              <li><strong>Super Admins:</strong> Can view all company data, including employee screenshots.</li>
              <li><strong>Platform Administrators (AidBro):</strong> Can access system-level data for support and platform maintenance purposes only.</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              7. Data Security
            </h2>
            <p className="mb-3">
              We employ industry-standard technical measures to secure your data:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>All data transmitted between the Agent, web frontend, and backend is encrypted over HTTPS.</li>
              <li>Passwords are stored using secure, one-way cryptographic hashing algorithms and are never stored in plain text.</li>
              <li>Database access is restricted exclusively to authorized operational personnel.</li>
              <li>Machine tokens for desktop agent authentication are unique per device, preventing token spoofing or sharing.</li>
            </ul>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              8. Staff Rights
            </h2>
            <p className="mb-3">
              Under this policy, staff members retain specific rights regarding their information:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>The right to request to view their own recorded personal and attendance data.</li>
              <li>The right to raise formal attendance or timeline disputes directly through the dashboard.</li>
              <li>The right to request corrections to their data through their designated system administrator.</li>
              <li>For any data deletion requests, staff must contact their company administrator.</li>
            </ul>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              9. Contact
            </h2>
            <p>
              For privacy and data concerns specific to your company's usage, please contact **the system administrator of your company**.
              For platform-level or technical infrastructure concerns, contact **AidBro (platform operator)**.
            </p>
          </section>

          {/* Section 10 */}
          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-bold text-blue-900 mb-3">
              10. Changes to This Policy
            </h2>
            <p>
              AidBro reserves the right to update this policy from time to time. Continued use of the WorkFlow system following an update constitutes acceptance of the modified terms and policies.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default LegalPolicy;
