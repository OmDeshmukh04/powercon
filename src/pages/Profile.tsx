import { useAppSelector } from '../redux/hooks';

export default function Profile() {
  const { user } = useAppSelector((state) => state.auth);
  const initials = user?.full_name?.slice(0, 1)?.toUpperCase() ?? 'U';

  return (
    <div className="page-enter">
      <div className="ph">
        <h1>Profile</h1>
        <p>View account details and role information</p>
      </div>

      <div className="prof-layout">
        <div className="prof-card">
          <div className="prof-av">{initials}</div>
          <div className="prof-name">{user?.full_name || 'CapSurge User'}</div>
          <span className="prof-badge">{user?.role || 'support'}</span>
          <div className="prof-meta">
            <div>
              <span>Email:</span> {user?.email || '—'}
            </div>
            <div>
              <span>User ID:</span> {user?.id || '—'}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="c-head">
            <div>
              <div className="c-title">Account Overview</div>
              <div className="c-sub">Sample-style profile panel</div>
            </div>
          </div>
          <div className="c-body">
            <div className="form-2col">
              <div className="fg">
                <label>Full Name</label>
                <input value={user?.full_name || ''} disabled />
              </div>
              <div className="fg">
                <label>Email</label>
                <input value={user?.email || ''} disabled />
              </div>
              <div className="fg">
                <label>Role</label>
                <input value={user?.role || ''} disabled />
              </div>
              <div className="fg">
                <label>Status</label>
                <input value={user?.is_active ? 'Active' : 'Inactive'} disabled />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
