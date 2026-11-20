namespace RotaryApi.Services;

/// <summary>
/// Starter help articles, inserted once when the help tables are empty (DatabaseInitializer.HelpCentre). Written from
/// the ROW screens as they are (admin sidebars, app Settings, sign-in pages). Super Admin edits them afterwards in
/// Settings > Help centre; editing here changes nothing on a database that already has articles.
/// </summary>
public static class HelpSeed
{
    public record Category(string Slug, string Name, string Description, int Sort);
    public record Article(string Category, string Slug, string Title, string Summary, string Keywords, string? ContextPath, string Body);

    public static readonly Category[] Categories =
    {
        new("getting-started", "Getting started", "Signing in, finding your way around and choosing your language.", 1),
        new("members-and-app", "Members and the app", "Using the ROW mobile app as a club member.", 2),
        new("club-administration", "Club administration", "Running your club in the web admin: members, reports, projects and people.", 3),
        new("communication", "Communication", "Announcements, mass email, greetings and chat.", 4),
        new("club-website", "Club website", "Setting up and editing your club's public website.", 5),
        new("district-administration", "District administration", "Tools for district teams and Assistant Governors.", 6),
        new("account-and-privacy", "Account, privacy and billing", "Passwords, your data, subscriptions and payments.", 7),
    };

    public static readonly Article[] Articles =
    {
        new("getting-started", "sign-in-to-row", "Sign in to ROW",
            "How to sign in to the web admin and the mobile app with your email address.",
            "sign in, login, log in, password, email code", "/login", @"
<p>ROW uses your email address to sign in, on the web and in the app. Your club or district administrator adds you to ROW, and you then sign in with the email address they used.</p>
<h2>On the web</h2>
<ol>
<li>Open the ROW sign-in page and enter your email address and password.</li>
<li>Tick <strong>Remember Me</strong> only on a computer that is yours.</li>
<li>Select <strong>Sign In</strong>.</li>
</ol>
<p>If you do not have a password yet, choose <strong>Sign in with an email code</strong>. ROW emails you a one-time code to type in.</p>
<h2>In the app</h2>
<p>Install ROW from the App Store or Google Play, open it and sign in with the same email address and password.</p>
<h2>If sign-in is refused</h2>
<ul>
<li>Check the email address for typing mistakes. It must be the one your club has on file.</li>
<li>After several failed tries ROW pauses sign-in for about a minute. Wait and try again.</li>
<li>If your district's trial has ended, the message says so. Your data is kept; ask your district to renew.</li>
</ul>"),

        new("getting-started", "reset-your-password", "Reset your password",
            "Forgot your password? Set a new one from the sign-in page.",
            "password, forgot password, reset, sign in", "/forgot-password", @"
<ol>
<li>On the sign-in page, select <strong>Forgot Password</strong>.</li>
<li>Enter the email address you sign in with and send the request.</li>
<li>Open the email from ROW and follow the link to choose a new password. The link works for a limited time.</li>
<li>Sign in with the new password, on the web and in the app.</li>
</ol>
<p>No email after a few minutes? Look in your spam or junk folder. If it is not there, your club administrator can check that ROW has the right email address for you.</p>"),

        new("getting-started", "choose-your-language", "Choose your language",
            "Use ROW in English, French, German, Italian, Japanese, Korean, Portuguese or Spanish.",
            "language, translation, french, german, italian, japanese, korean, portuguese, spanish", null, @"
<p>ROW can show its screens in eight languages: English, French, German, Italian, Japanese, Korean, Portuguese and Spanish.</p>
<h2>On the web</h2>
<p>Use the language picker at the top of the page. Your choice is remembered in that browser.</p>
<h2>In the app</h2>
<ol>
<li>Open <strong>Settings</strong>.</li>
<li>Tap <strong>Language</strong> and pick yours.</li>
</ol>
<p>Screens are translated by machine. Names, club names and what people write (announcements, notes) stay as they were entered. Emails from ROW use the language set on your profile, or your club's language when you have not chosen one.</p>"),

        new("getting-started", "find-your-way-around-the-admin", "Find your way around the web admin",
            "What the dashboards are and how to switch between your roles and Rotary years.",
            "dashboard, role, rotary year, year picker, navigation, sidebar", "/club-admin-dashboard/dashboard", @"
<p>When you sign in, ROW opens the dashboard for your role: Club Admin, District Admin or Assistant Governor. If you hold more than one role, the sidebar lets you switch between them.</p>
<h2>The sidebar</h2>
<p>Each module has its own entry in the sidebar, for example <strong>Membership</strong>, <strong>Projects / Events</strong>, <strong>E-Governance</strong> and <strong>Communication</strong>. Some modules appear only when your district or the platform has switched them on.</p>
<h2>Rotary years</h2>
<p>Most pages show one Rotary year (1 July to 30 June). Use the year picker at the top of the dashboard to look at another year. Past years can be read; whether you can still change them depends on the rights your district gave you for that year.</p>"),

        new("members-and-app", "using-the-row-app", "Get started with the ROW app",
            "What members can do in the app: directory, calendar, notifications and more.",
            "app, mobile, directory, calendar, notifications, members", null, @"
<p>The ROW app is for every member of a club using ROW. After you sign in you can:</p>
<ul>
<li>Look up members of your club in the directory.</li>
<li>See your club's meetings and events in the calendar, with times in your own time zone.</li>
<li>Read announcements and get push notifications from your club and district.</li>
<li>Find other Rotarians and clubs.</li>
<li>Chat with members, where your club has chat turned on.</li>
<li>Update your own profile.</li>
</ul>
<p>Officers see extra tools for their role, such as targets and admin screens.</p>"),

        new("members-and-app", "add-meetings-to-your-phone-calendar", "Add club meetings to your phone calendar",
            "Create a personal calendar link so meetings and events appear in your calendar app.",
            "calendar, feed, ical, meetings, events, phone", null, @"
<p>Where your club has meetings turned on, you can follow your clubs' meetings and events in your phone's own calendar app.</p>
<ol>
<li>In the app, open <strong>Settings</strong>, then <strong>Communication</strong>.</li>
<li>Under <strong>Calendar feed</strong>, tap <strong>Create my calendar link</strong>.</li>
<li>Tap <strong>Open in calendar app</strong>, or <strong>Copy link</strong> and add it as a subscribed calendar.</li>
</ol>
<p>The link is personal. If you shared it by mistake, tap <strong>Make a new link</strong>: the old one stops working.</p>"),

        new("members-and-app", "choose-email-and-push-messages", "Choose which messages you receive",
            "Turn club emails and push notifications on or off, and set your email language.",
            "email, push, notifications, consent, unsubscribe, newsletter", null, @"
<ol>
<li>In the app, open <strong>Settings</strong>, then <strong>Communication</strong>.</li>
<li>Switch <strong>Email</strong> off to stop newsletters, announcements and mass emails from your club and district.</li>
<li>Switch <strong>Push notifications</strong> off to stop app alerts.</li>
</ol>
<p>Messages you need for your account, such as password resets, are still sent. Every newsletter email also has an unsubscribe link.</p>
<p>This screen appears once your club uses ROW's email features.</p>"),

        new("club-administration", "add-and-manage-members", "Add and manage club members",
            "Keep your member directory up to date: add members, edit details and record when someone leaves.",
            "members, membership, directory, add member, remove member, termination", "/club-admin-dashboard/membership", @"
<p>Open <strong>Membership</strong> in the Club Admin sidebar. You see the member directory with totals, new joiners this Rotary year and monthly growth.</p>
<h2>Find a member</h2>
<p>Use <strong>Search members</strong> to filter by name.</p>
<h2>Add or edit</h2>
<p>Add a member with their name and email address. The email address is what they use to sign in, so check it carefully. Open a member to edit their details, membership type and join reason.</p>
<h2>When a member leaves</h2>
<p>Remove the member from the club and pick the termination reason. Their attendance and payment history stays in the club's records.</p>
<p>If your club is linked to Rotary.org, membership changes are compared with Rotary's records during the sync.</p>"),

        new("club-administration", "record-attendance-and-monthly-reports", "Record attendance and send the monthly report",
            "Use E-Governance for meetings, attendance and the Club Monthly Report.",
            "attendance, meeting, monthly report, cmr, e-governance, reporting", "/club-admin-dashboard/e-governance", @"
<p>Open <strong>E-Governance</strong> in the Club Admin sidebar. It holds attendance, reports, citations and what you submit to the district.</p>
<h2>Attendance</h2>
<ol>
<li>Open the <strong>Attendance</strong> tab and add the meeting with its date, time and mode: in person, online or hybrid.</li>
<li>Mark who attended. Meeting times are entered in your club's local time.</li>
</ol>
<h2>Club Monthly Report</h2>
<p>Open <strong>Club Monthly Report</strong>, check the figures ROW has filled in from your records, complete the rest and submit it. Your district receives it, and ROW sends a reminder when a report has not been submitted.</p>"),

        new("club-administration", "projects-and-events", "Add service projects and events",
            "Record your club's projects and events with their Area of Focus.",
            "projects, events, service, area of focus, public image", "/club-admin-dashboard/foundation", @"
<p>Open <strong>Projects / Events</strong> in the Club Admin sidebar to record what your club does.</p>
<ol>
<li>Add a project or event with its title, date and description.</li>
<li>Choose its <strong>Area of Focus</strong>. ROW uses the Rotary Areas of Focus to group projects.</li>
<li>Add photos and the figures the form asks for.</li>
</ol>
<p><strong>Service Projects &amp; Public Image</strong> shows the same work grouped for reporting. Projects can also appear on your club website.</p>"),

        new("club-administration", "volunteers-speakers-and-duties", "Organise volunteers, speakers and meeting duties",
            "Run sign-up sheets for volunteers and plan speakers and duties for coming meetings.",
            "volunteers, sign-up sheet, speakers, duties, meetings", "/club-admin-dashboard/volunteers", @"
<p>These two modules appear when the volunteers feature is on for your club.</p>
<h2>Volunteers</h2>
<p>Open <strong>Volunteers</strong> and create a sign-up sheet with its time slots and the number of places in each. Members sign up in the app, and the page shows the places taken.</p>
<h2>Speakers and meeting duties</h2>
<p>Open <strong>Speakers &amp; Duties</strong>. Add a speaker with the meeting date and topic; their email and phone are for the club only and are not shown on the website. Assign members to duties for coming meetings. Speakers booked for the next 30 days are listed in the club newsletter email.</p>"),

        new("club-administration", "goals-and-targets", "Set goals and follow your targets",
            "Enter the club's goals for the Rotary year and respond to targets proposed by the district.",
            "goals, goal setting, targets, district target, proposal", "/club-admin-dashboard/targets", @"
<h2>Goal Setting</h2>
<p>Open <strong>Goal Setting</strong> to enter your club's goals for the Rotary year. The district sees them in its goal overview.</p>
<h2>Targets</h2>
<p>Open <strong>Targets</strong> to see your club's live figures against its targets. When your district proposes a target for a metric such as membership growth or Foundation giving, you can accept it or reply with your own value and a note. The district sees your answer and can propose again.</p>"),

        new("communication", "announcements-and-newsletters", "Publish announcements, events and newsletters",
            "Share news with your members in the app and by email.",
            "announcements, newsletters, documents, events, communication, publish", "/club-admin-dashboard/communication", @"
<p>Open <strong>Communication</strong> in the Club Admin sidebar. The tabs are Announcements, Upcoming Events, Newsletters, Documents, Greetings, Mass Email, Subgroups and Web Links.</p>
<h2>Announcements</h2>
<ol>
<li>Add an announcement with a title and text.</li>
<li>Set the <strong>Publish Date</strong> and an <strong>Expiry Date</strong>; it shows to members between those dates.</li>
<li>Choose whether to show it on the banner and whether to repeat the notification.</li>
</ol>
<h2>Newsletters and documents</h2>
<p>Upload a newsletter or document and choose who may open it. Members find them in the app.</p>
<h2>Subgroups</h2>
<p>Make subgroups, such as a committee, to send to some members only.</p>"),

        new("communication", "send-a-mass-email", "Send a mass email to members",
            "Write an email with the editor and send it to your club or a subgroup.",
            "mass email, email, send, newsletter, subgroup, brevo", "/club-admin-dashboard/communication/mass-email", @"
<ol>
<li>In <strong>Communication</strong>, open the <strong>Mass Email</strong> tab and start a new email.</li>
<li>Choose the recipients: the whole club or a subgroup.</li>
<li>Write the subject and message. You can add headings, lists, links and pictures; pictures are uploaded so they show in every mail program.</li>
<li>Send now, or schedule it for later.</li>
</ol>
<p>Members who switched email off do not receive it. The email log shows what was sent and any addresses that bounced. Your club's monthly email allowance and sender name are under <strong>Email Settings</strong>.</p>"),

        new("communication", "birthday-and-anniversary-greetings", "Birthday and anniversary greetings",
            "ROW greets members on their birthdays and anniversaries. Edit the wording for your club.",
            "greetings, birthday, anniversary, wedding, messages", null, @"
<p>ROW sends greetings for members' birthdays and wedding anniversaries from the dates in their profiles.</p>
<p>In <strong>Communication</strong>, open <strong>Greetings</strong> to see today's greetings and those coming up this week and this month. Choose <strong>Edit birthday &amp; anniversary messages</strong> to change the wording your club sends.</p>
<p>A member who has no date in their profile is not greeted, so ask members to complete their profile.</p>"),

        new("communication", "chat-and-moderation", "Club chat and reported messages",
            "How chat works in the app and how officers handle reported messages.",
            "chat, messages, report, moderation", "/club-admin-dashboard/chat-moderation", @"
<p>When chat is turned on, members can message each other in the app.</p>
<p>Any member can report a message. Reported messages appear in <strong>Chat Moderation</strong> in the Club Admin sidebar, where an officer reads the message and decides whether to remove it.</p>"),

        new("club-website", "set-up-your-club-website", "Set up your club website",
            "Choose a theme and fill in the sections of your club's public website.",
            "website, club website, theme, banner, about, contact, menu", "/club-admin-dashboard/my-club-website", @"
<p>Open <strong>My Club Website</strong> in the Club Admin sidebar. Each card edits one part of your site:</p>
<ul>
<li><strong>Change Theme</strong>: pick a colour palette and visual style.</li>
<li><strong>Banner Photos</strong>: the pictures in the homepage carousel.</li>
<li><strong>About</strong>: the text that introduces your club.</li>
<li><strong>Contact Details</strong>: phone, email and address shown in the footer.</li>
<li>Menu: reorder, rename and hide menu items.</li>
<li><strong>Advertisement Area</strong>: sponsor and promo blocks.</li>
<li>Languages: offer the site in more languages.</li>
</ul>
<p>Your events, projects and board are taken from ROW, so the site stays current without extra work. If the page says the website is not yet set up, your plan does not include a website yet; see <strong>Subscription</strong>.</p>"),

        new("district-administration", "district-dashboard-overview", "The District Admin dashboard",
            "What district teams can see and do across their clubs.",
            "district, district admin, clubs, overview, compliance", "/district-admin-dashboard", @"
<p>District Admins see every club in the district. From the sidebar you can:</p>
<ul>
<li>Follow membership, meetings and reporting across clubs.</li>
<li>Check which clubs have sent their monthly reports, and see meeting compliance.</li>
<li>Propose targets to clubs and follow goal setting.</li>
<li>Send communication to the whole district.</li>
<li>Assign Assistant Governors to clubs.</li>
<li>Manage the district website and quick links.</li>
</ul>"),

        new("district-administration", "assistant-governors", "Assign Assistant Governors to clubs",
            "Give an Assistant Governor access to the clubs they look after.",
            "assistant governor, ag, clubs, assign, access", "/district-admin-dashboard/ag", @"
<ol>
<li>Open the Assistant Governor page in the District Admin sidebar.</li>
<li>Choose the member and the clubs they look after for the Rotary year.</li>
<li>Save. ROW emails the Assistant Governor that they were assigned.</li>
</ol>
<p>An Assistant Governor sees only their assigned clubs, on their own AG dashboard, and can read those clubs' reports.</p>"),

        new("account-and-privacy", "download-your-data", "Download your data or withdraw consent",
            "See what ROW holds about you and ask for a copy.",
            "privacy, my data, download, consent, gdpr, erase", null, @"
<ol>
<li>In the app, open <strong>Settings</strong>, then <strong>My data</strong>.</li>
<li>Ask for a download of your data, or withdraw a consent you gave.</li>
</ol>
<p>Requests to correct or erase your data go to your club or district, who handle them in ROW. Attendance and payment totals are kept for the club's records after an erasure, without your name.</p>
<p>The Privacy Policy on the ROW website explains what is collected and why.</p>"),

        new("account-and-privacy", "subscriptions-and-renewals", "Subscriptions and renewals",
            "See your club's or district's plan, and renew it.",
            "subscription, renew, plan, trial, billing, payment", "/club-admin-dashboard/subscription", @"
<p>Open <strong>Subscription</strong> in the Club Admin or District Admin sidebar. It shows your current plan, its state (active, in grace, or expired) and when the term ends.</p>
<p>Officers who may buy see the option to renew. The price is set by ROW and shown before you pay.</p>
<p>District Admins get an email 60 days before the term ends, and reminders after it if the term was not renewed. This page always stays open, even when a subscription has ended, so you can renew.</p>"),

        new("account-and-privacy", "app-lock", "Lock the app with Face ID or a passcode",
            "Ask for your phone's Face ID, fingerprint or passcode each time the app opens.",
            "app lock, face id, fingerprint, passcode, security", null, @"
<ol>
<li>In the app, open <strong>Settings</strong>.</li>
<li>Tap <strong>App Lock</strong> and switch it on.</li>
</ol>
<p>From then on the app asks for your phone's Face ID, fingerprint or passcode when it opens. This protects member contact details if someone else uses your phone.</p>"),
    };
}
