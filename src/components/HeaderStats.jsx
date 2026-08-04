// Running totals, pinned to the top bar. They used to sit inside the Add form,
// where they scrolled past the field the typist was actually looking at.
export default function HeaderStats({ stats }) {
  return (
    <div className="header-stats">
      <div className="header-stat">
        <span className="header-stat-num">{stats.total_residents}</span>
        <span className="header-stat-label">Residents</span>
      </div>
      <div className="header-stat">
        <span className="header-stat-num">{stats.total_votes}</span>
        <span className="header-stat-label">Voters</span>
      </div>
    </div>
  );
}
