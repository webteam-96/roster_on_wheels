// A custom page built in the admin (Website Data, Pages and Layout), served at /p/<slug>. Menus link it as /p/<slug>.
// A members-only page asks for the member sign-in first; the API returns nothing of it before that.
import { Navigate, useParams } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import Breadcrumb from '../shared/Breadcrumb.jsx'
import Skeleton from '../shared/Skeleton.jsx'
import PageSections from '../shared/PageSections.jsx'
import MemberSignIn from '../shared/MemberSignIn.jsx'
import { forgetMemberSession, readMemberSession, useWebsitePage } from '../shared/websitePages.js'

export default function CustomPage() {
  const { slug } = useParams()
  const { clubId, clubDisplayName } = useClub()
  const [state, reload] = useWebsitePage(clubId, slug === 'home' ? '' : slug)

  if (state === undefined) {
    return <section className="py-12"><div className="container-x"><Skeleton label="Loading page" /></div></section>
  }
  // Unknown or unpublished page: same as any unknown path on this site (the catch-all sends it home).
  if (state.status === 'missing') return <Navigate to="/" replace />
  if (state.status === 'members') {
    return (
      <>
        <Breadcrumb eyebrow={clubDisplayName} title="Members only" crumbLabel="Members only" />
        <MemberSignIn clubId={clubId} clubName={clubDisplayName} onSignedIn={reload} />
      </>
    )
  }
  const { page } = state
  const member = page.membersOnly ? readMemberSession(clubId) : null
  return (
    <>
      <Breadcrumb eyebrow={clubDisplayName} title={page.title} crumbLabel={page.title} />
      {member ? (
        <div className="container-x flex flex-wrap items-center justify-end gap-3 pt-4 text-[13px] text-muted">
          <span>Signed in{member.name ? ' as ' + member.name : ''}</span>
          <button type="button" className="font-semibold text-navy underline"
                  onClick={() => { forgetMemberSession(clubId); reload() }}>Sign out</button>
        </div>
      ) : null}
      <PageSections page={page} />
    </>
  )
}
