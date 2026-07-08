const arrivals = [
  { name: "Mira L.", bed: "Dorm A - 04", time: "14:00", status: "Ready" },
  { name: "Jonas K.", bed: "Private 2", time: "15:30", status: "Balance due" },
  { name: "Ava R.", bed: "Dorm C - 11", time: "18:10", status: "Docs needed" },
];

const tasks = [
  { label: "Dorm A turnover", owner: "Housekeeping", due: "12:30" },
  { label: "Private 2 inspection", owner: "Maintenance", due: "13:00" },
  { label: "Night audit prep", owner: "Front desk", due: "21:00" },
];

const stats = [
  { label: "Occupancy", value: "83%", detail: "42 of 51 beds" },
  { label: "Arrivals", value: "18", detail: "6 before 16:00" },
  { label: "Departures", value: "11", detail: "3 late check-outs" },
  { label: "Open tasks", value: "7", detail: "2 high priority" },
];

export function HomeDashboard() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">BunkFy</div>
        <nav className="nav">
          <a className="navItem active" href="#today">Today</a>
          <a className="navItem" href="#reservations">Reservations</a>
          <a className="navItem" href="#inventory">Inventory</a>
          <a className="navItem" href="#guests">Guests</a>
          <a className="navItem" href="#housekeeping">Housekeeping</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Harbor Yard Hostel</p>
            <h1>Today</h1>
          </div>
          <div className="datePill">Wed, Jul 8</div>
        </header>

        <section className="statsGrid" aria-label="Daily summary">
          {stats.map((stat) => (
            <article className="statCard" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.detail}</small>
            </article>
          ))}
        </section>

        <section className="contentGrid">
          <article className="panel">
            <div className="panelHeader">
              <h2>Arrivals</h2>
              <button type="button">New booking</button>
            </div>
            <div className="table" role="table" aria-label="Arrivals">
              <div className="tableRow tableHead" role="row">
                <span role="columnheader">Guest</span>
                <span role="columnheader">Bed</span>
                <span role="columnheader">ETA</span>
                <span role="columnheader">Status</span>
              </div>
              {arrivals.map((arrival) => (
                <div className="tableRow" role="row" key={arrival.name}>
                  <span role="cell">{arrival.name}</span>
                  <span role="cell">{arrival.bed}</span>
                  <span role="cell">{arrival.time}</span>
                  <span className="status" role="cell">{arrival.status}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panelHeader">
              <h2>Tasks</h2>
              <button type="button">Assign</button>
            </div>
            <ul className="taskList">
              {tasks.map((task) => (
                <li key={task.label}>
                  <div>
                    <strong>{task.label}</strong>
                    <span>{task.owner}</span>
                  </div>
                  <time>{task.due}</time>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

