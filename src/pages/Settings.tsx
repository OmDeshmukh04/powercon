export default function Settings() {
  return (
    <div className="page-enter">
      <div className="ph">
        <h1>Settings</h1>
        <p>Personalize notifications and interface preferences</p>
      </div>

      <div className="card">
        <div className="c-head">
          <div>
            <div className="c-title">Preferences</div>
            <div className="c-sub">Styled to match sample account settings</div>
          </div>
        </div>
        <div className="c-body">
          <div className="tgl-row">
            <div>
              <div className="tgl-title">Email alerts</div>
              <div className="tgl-desc">Receive notifications for upload and reconciliation events</div>
            </div>
            <div className="tgl on" />
          </div>
          <div className="tgl-row">
            <div>
              <div className="tgl-title">Compact tables</div>
              <div className="tgl-desc">Reduce row height for denser data view</div>
            </div>
            <div className="tgl" />
          </div>
          <div className="tgl-row">
            <div>
              <div className="tgl-title">Weekly summary</div>
              <div className="tgl-desc">Send dashboard summary each week</div>
            </div>
            <div className="tgl on" />
          </div>
        </div>
      </div>
    </div>
  );
}
