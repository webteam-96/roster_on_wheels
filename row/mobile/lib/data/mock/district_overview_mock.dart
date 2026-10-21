import '../models/district_overview_models.dart';

/// Mock data for the District Overview dashboard.
///
/// Ports the seed-based generators from the React reference at
/// `AG_module-master/src/modules/district/data/{analyticsData,foundationData,
/// egovernanceData}.js` to Dart. Numbers are deterministic and match the
/// React build pixel-for-pixel.
///
/// To replace with real data later, keep the same exported names
/// (`kClubAnalytics`, `kDistrictProjects`, `kCitationCriteria`,
/// `kClubCitations`) and `DistrictAnalyticsService` will continue to work.

// ── Source corpus (names, meeting days/times, project templates) ────────

const _days = <String>[
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const _times = <String>[
  '7:00 AM', '7:30 AM', '8:00 AM', '12:30 PM',
  '1:00 PM', '6:30 PM', '7:00 PM', '7:30 PM',
];

const _highClubs = <String>[
  'Thane City View', 'Tikujiniwadi', 'Thane Heritage', 'Navi Mumbai Central',
  'Vashi Sunrise', 'Nerul Bay', 'Belapur Heights', 'Kharghar Hills',
  'Kalyan East', 'Kalyan Sunrise', 'Dombivli Premier', 'Mira Road North',
  'Bhayandar Esteem', 'Vasai Vikas', 'Thane Uptown', 'Powai Lakeside',
  'Mulund East', 'Ghatkopar Prestige', 'Thane Midtown', 'Koparkhairane Tech',
  'Panvel Gateway', 'Airoli Industrial', 'Chembur Elite', 'Thane Elite',
  'Vashi Central',
];

const _midClubs = <String>[
  'Owala', 'Lake Shore Club', 'Rotary Club of Leo', 'Thane West',
  'Thane Central', 'Thane North', 'Kalyan West', 'Kalyan Central',
  'Dombivli East', 'Dombivli West', 'Ulhasnagar Central', 'Ulhasnagar East',
  'Ambernath Industrial', 'Badlapur New Town', 'Bhiwandi North',
  'Bhiwandi East', 'Mira Bhayandar', 'Vasai Road', 'Virar West',
  'Nalasopara East', 'Navi Mumbai South', 'Nerul West', 'Belapur CBD',
  'Turbhe MIDC', 'Ghansoli East', 'Sanpada Heights', 'Kharghar Sector',
  'Taloja Industrial', 'Panvel East', 'Pen Valley', 'Alibag Coastal',
  'Uran Port', 'Karjat Hills', 'Khopoli Gateway', 'Roha River',
  'Mangaon Central', 'Mahad Industrial', 'Raigad Heritage', 'Thane Lakeside',
  'Thane Cosmos', 'Thane Grandeur', 'Kalyan Metro', 'Dombivli Central',
  'Mira Road South', 'Navi Mumbai North', 'Vashi Harbour', 'Nerul South',
  'Airoli West', 'Ghansoli Central', 'Sanpada Bay',
];

const _lowClubs = <String>[
  'New Club Test Entry', 'Titwala East', 'Titwala West', 'Murbad Rural',
  'Wada Township', 'Shahapur Hills', 'Jawhar Tribal', 'Vikramgad Village',
  'Mokhada Remote', 'Dahanu Coastal', 'Talasari Border', 'Palghar North',
  'Palghar South', 'Boisar Industrial', 'Vangaon Station', 'Gholvad East',
  'Nalasopara West', 'Saphale Rural', 'Kelwa Beach', 'Manor District',
  'Kasa Village', 'Zhari Rural', 'Khardi Hills', 'Umbermali Remote',
  'Tokavde New',
];

// Project templates — same set the React reference uses for project synthesis.
class _ProjectTemplate {
  final String name;
  final String avenue;
  final int fundsFactor;
  final int hoursFactor;
  final int beneFactor;
  const _ProjectTemplate({
    required this.name,
    required this.avenue,
    required this.fundsFactor,
    required this.hoursFactor,
    required this.beneFactor,
  });
}

const _projectTemplates = <_ProjectTemplate>[
  _ProjectTemplate(name: 'Blood Donation Drive',         avenue: 'Community Service',     fundsFactor: 0,      hoursFactor: 48, beneFactor: 300),
  _ProjectTemplate(name: 'Medical Camp',                 avenue: 'Community Service',     fundsFactor: 90000,  hoursFactor: 96, beneFactor: 400),
  _ProjectTemplate(name: 'Tree Plantation Drive',        avenue: 'Community Service',     fundsFactor: 20000,  hoursFactor: 60, beneFactor: 500),
  _ProjectTemplate(name: 'Eye Check-up Camp',            avenue: 'Community Service',     fundsFactor: 40000,  hoursFactor: 32, beneFactor: 280),
  _ProjectTemplate(name: 'Senior Citizen Health Camp',   avenue: 'Community Service',     fundsFactor: 35000,  hoursFactor: 40, beneFactor: 180),
  _ProjectTemplate(name: 'Clean Village Drive',          avenue: 'Community Service',     fundsFactor: 18000,  hoursFactor: 60, beneFactor: 450),
  _ProjectTemplate(name: 'Digital Literacy Workshop',    avenue: 'Vocational Service',    fundsFactor: 18000,  hoursFactor: 36, beneFactor: 90),
  _ProjectTemplate(name: 'Vocational Training Camp',     avenue: 'Vocational Service',    fundsFactor: 70000,  hoursFactor: 72, beneFactor: 75),
  _ProjectTemplate(name: 'Women Empowerment Workshop',   avenue: 'Vocational Service',    fundsFactor: 28000,  hoursFactor: 48, beneFactor: 120),
  _ProjectTemplate(name: 'Career Guidance Seminar',      avenue: 'Vocational Service',    fundsFactor: 8000,   hoursFactor: 16, beneFactor: 75),
  _ProjectTemplate(name: 'Scholarship Distribution',     avenue: 'New Generation',        fundsFactor: 180000, hoursFactor: 24, beneFactor: 45),
  _ProjectTemplate(name: 'Youth Leadership Camp',        avenue: 'New Generation',        fundsFactor: 25000,  hoursFactor: 40, beneFactor: 50),
  _ProjectTemplate(name: 'Interact Club Installation',   avenue: 'New Generation',        fundsFactor: 12000,  hoursFactor: 20, beneFactor: 60),
  _ProjectTemplate(name: 'RYLA District',                avenue: 'New Generation',        fundsFactor: 45000,  hoursFactor: 72, beneFactor: 40),
  _ProjectTemplate(name: 'Solar Light Distribution',     avenue: 'International Service', fundsFactor: 85000,  hoursFactor: 30, beneFactor: 100),
  _ProjectTemplate(name: 'Awareness Walk',               avenue: 'Public Image',          fundsFactor: 5000,   hoursFactor: 12, beneFactor: 500),
  _ProjectTemplate(name: 'Mega Blood Donation Camp',     avenue: 'Community Service',     fundsFactor: 0,      hoursFactor: 96, beneFactor: 650),
  _ProjectTemplate(name: 'Water Conservation Project',   avenue: 'Community Service',     fundsFactor: 60000,  hoursFactor: 80, beneFactor: 800),
];

const _projectDates = <String>[
  'Jul 15, 2025', 'Aug 10, 2025', 'Sep 20, 2025', 'Oct 5, 2025',
  'Nov 12, 2025', 'Dec 18, 2025', 'Jan 25, 2026', 'Feb 14, 2026',
  'Mar 15, 2026', 'Apr 10, 2026', 'May 5, 2026', 'Jun 8, 2026',
];

const _projectStatuses = <String>[
  'Completed', 'Completed', 'Completed', 'Completed', 'In Progress', 'Upcoming',
];

// Event-template / venue / date / time / status pools — ports of
// EVENT_TEMPLATES, VENUES, EVENT_DATES, EVENT_TIMES, EVENT_STATUSES
// from foundationData.js. Drive the Foundation → Events sub-tab.

class _EventTemplate {
  final String name;
  final String type;
  const _EventTemplate({required this.name, required this.type});
}

const _eventTemplates = <_EventTemplate>[
  _EventTemplate(name: 'Weekly Meeting',             type: 'Meeting'),
  _EventTemplate(name: 'Monthly Meeting',            type: 'Meeting'),
  _EventTemplate(name: 'Fortnightly Meeting',        type: 'Meeting'),
  _EventTemplate(name: 'Blood Donation Camp',        type: 'Service'),
  _EventTemplate(name: 'Medical Camp',               type: 'Service'),
  _EventTemplate(name: 'TRF Fundraiser Dinner',      type: 'TRF'),
  _EventTemplate(name: 'Foundation Awareness Night', type: 'TRF'),
  _EventTemplate(name: 'Youth Leadership Event',     type: 'New Gen'),
  _EventTemplate(name: 'Interact Meeting',           type: 'New Gen'),
  _EventTemplate(name: 'Career Fair',                type: 'Service'),
];

const _venues = <String>[
  'Club Hall', 'Hotel Regency, Thane', 'Community Centre', 'Municipal Hall',
  'School Auditorium', 'Hotel Solitaire', 'Banquet Hall', 'Online / Zoom',
];

const _eventDates = <String>[
  '2025-10-05', '2025-11-08', '2025-12-12', '2026-01-09', '2026-02-06',
  '2026-03-06', '2026-04-05', '2026-04-20', '2026-05-08', '2026-06-05',
];

const _eventTimes = <String>[
  '7:00 AM', '7:30 PM', '6:30 PM', '9:00 AM', '10:00 AM', '5:30 PM', '7:00 PM',
];

const _eventStatuses = <String>[
  'Completed', 'Completed', 'Upcoming', 'Upcoming',
];

// 4-event district prefix — same shape as makeEvents output but hand-curated.
const _districtEventsPrefix = <DistrictEvent>[
  DistrictEvent(id: 1, club: 'District 5656', name: 'District Assembly',        type: 'District', date: '2026-05-03', time: '9:00 AM',  venue: 'Hotel Vivanta, Thane', status: 'Upcoming'),
  DistrictEvent(id: 2, club: 'District 5656', name: 'District Conference',      type: 'District', date: '2026-06-14', time: '10:00 AM', venue: 'Grand Hyatt, Mumbai',  status: 'Upcoming'),
  DistrictEvent(id: 3, club: 'District 5656', name: 'DG Installation Ceremony', type: 'District', date: '2026-07-01', time: '6:00 PM',  venue: 'Hotel Regency, Thane', status: 'Upcoming'),
  DistrictEvent(id: 4, club: 'District 5656', name: 'District Citation Review', type: 'District', date: '2026-04-28', time: '6:00 PM',  venue: 'Online / Zoom',        status: 'Upcoming'),
];

// ── Roster name pools (port of analyticsData.js MALE_FIRST / FEMALE_FIRST
//    / SURNAMES / BOARD_ROLES) ───────────────────────────────────────────

const _maleFirst = <String>[
  'Rajesh', 'Suresh', 'Amit', 'Vijay', 'Sanjay', 'Pradeep', 'Mahesh',
  'Dinesh', 'Ramesh', 'Nilesh', 'Rakesh', 'Deepak', 'Vivek', 'Manish',
  'Anil', 'Sunil', 'Kapil', 'Girish', 'Harish', 'Sachin', 'Rohit',
  'Nikhil', 'Rahul', 'Ankit', 'Varun', 'Pankaj', 'Tarun', 'Arun',
  'Vikas', 'Umesh',
];

const _femaleFirst = <String>[
  'Sunita', 'Priya', 'Neha', 'Pooja', 'Sneha', 'Seema', 'Kavita', 'Anita',
  'Geeta', 'Rekha', 'Lata', 'Divya', 'Nisha', 'Meena', 'Asha', 'Usha',
  'Rupa', 'Shobha', 'Hema', 'Jaya',
];

const _surnames = <String>[
  'Sharma', 'Verma', 'Patel', 'Shah', 'Joshi', 'Mehta', 'Desai', 'Nair',
  'Kumar', 'Singh', 'Gupta', 'Rao', 'Iyer', 'Reddy', 'Kulkarni', 'Patil',
  'Deshpande', 'Bhatt', 'Chauhan', 'Mishra', 'Thakur', 'Pandey',
  'Agarwal', 'Bose', 'Chatterjee',
];

const _boardRoles = <String>[
  'President', 'Secretary', 'Treasurer', 'IPP', 'President Elect',
  'Vice President', 'Director', 'Member', 'Member', 'Member', 'Member',
  'Member', 'Member',
];

List<RosterMember> _makeRoster(int seed, int count) {
  return List<RosterMember>.generate(count, (i) {
    final isFemale = (seed * 3 + i * 7) % 5 == 0;
    final first = isFemale
        ? _femaleFirst[(seed + i * 3) % _femaleFirst.length]
        : _maleFirst[(seed * 2 + i) % _maleFirst.length];
    final last = _surnames[(seed * 7 + i * 11) % _surnames.length];
    final padded =
        (seed * 100 + i).toString().padLeft(8, '0').substring(0, 8);
    return RosterMember(
      name: '$first $last',
      designation: _boardRoles[i < _boardRoles.length - 1
          ? i
          : _boardRoles.length - 1],
      mobile: '+1 55$padded',
      email: '${first.toLowerCase()}.${last.toLowerCase()}$seed@email.com',
      since: 2010 + ((seed + i * 3) % 14),
      status: (seed * 5 + i * 3) % 7 != 0 ? 'Active' : 'Inactive',
    );
  });
}

// ── Seed-based generators (port of React makeClub / makeProjects) ───────

String _slug(String n) => n
    .toLowerCase()
    .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
    .replaceAll(RegExp(r'^-|-$'), '');

ClubAnalytics _makeClub(String name, String tier, int seed) {
  final s = seed + 1;
  final hi = tier == 'high';
  final lo = tier == 'low';

  final members = hi
      ? 80 + (s * 3 % 71)
      : lo
          ? 12 + (s * 2 % 19)
          : 30 + (s * 5 % 51);
  final memberTarget =
      (members * (hi ? 1.08 : lo ? 1.25 : 1.15)).round();
  final activePct = hi
      ? 0.87 + (s % 9) * 0.01
      : lo
          ? 0.60 + (s % 12) * 0.01
          : 0.73 + (s % 13) * 0.01;
  final activeMembers = (members * activePct).round();
  final maleMembers = (members * (0.62 + (s % 9) * 0.01)).round();
  final femaleMembers = (members * (0.17 + (s % 6) * 0.01)).round();
  final honoraryRaw =
      members - activeMembers - (members * 0.04).round();
  final honoraryMembers = honoraryRaw < 0 ? 0 : honoraryRaw;
  final newThisYear = hi ? 3 + (s % 8) : lo ? s % 3 : 1 + (s % 5);
  final terminated = lo ? 1 + (s % 4) : s % 3;

  final trfGoal = hi
      ? 200000 + (s * 13 % 300001)
      : lo
          ? 50000 + (s * 7 % 50001)
          : 100000 + (s * 11 % 100001);
  final trfPctVal = hi
      ? 0.60 + (s % 36) * 0.01
      : lo
          ? 0.10 + (s % 31) * 0.01
          : 0.30 + (s % 41) * 0.01;
  final trfRaised = (trfGoal * trfPctVal).round();
  final annualFund = (trfRaised * 0.55).round();
  final phfContributors = hi ? 10 + (s % 15) : lo ? 1 + (s % 4) : 4 + (s % 8);
  final majorDonors = hi ? 1 + (s % 5) : lo ? 0 : s % 3;

  final serviceProjects = hi ? 8 + (s % 11) : lo ? 1 + (s % 4) : 3 + (s % 8);
  final beneficiaries = hi
      ? 1500 + (s * 7 % 1501)
      : lo
          ? 100 + (s * 3 % 401)
          : 400 + (s * 5 % 1101);
  final manHours = serviceProjects * (30 + s % 50);

  final citationScore = hi
      ? (40 + (s % 11)) * 20
      : lo
          ? (8 + (s % 17)) * 20
          : (22 + (s % 18)) * 20;
  final reportsSubmitted = hi ? 9 + (s % 3) : lo ? 2 + (s % 5) : 5 + (s % 5);
  final avgAttendance = hi ? 78 + (s % 18) : lo ? 30 + (s % 26) : 52 + (s % 27);

  final rosterCount = hi ? 13 + (s % 3) : lo ? 8 + (s % 3) : 10 + (s % 4);

  return ClubAnalytics(
    id: _slug(name),
    name: name,
    meetingDay: _days[(seed * 3 + tier.length) % _days.length],
    meetingTime: _times[(seed * 5 + tier.length) % _times.length],
    members: members,
    memberTarget: memberTarget,
    activeMembers: activeMembers,
    maleMembers: maleMembers,
    femaleMembers: femaleMembers,
    honoraryMembers: honoraryMembers,
    newThisYear: newThisYear,
    terminated: terminated,
    trfRaised: trfRaised,
    trfGoal: trfGoal,
    annualFund: annualFund,
    phfContributors: phfContributors,
    majorDonors: majorDonors,
    serviceProjects: serviceProjects,
    beneficiaries: beneficiaries,
    manHours: manHours,
    citationScore: citationScore,
    citationMax: 1000,
    reportsSubmitted: reportsSubmitted,
    reportsTotal: 12,
    avgAttendance: avgAttendance,
    memberRoster: _makeRoster(seed, rosterCount),
  );
}

List<DistrictProject> _makeProjects(String club, int seed, int Function() nextId) {
  final count = 2 + (seed % 4);
  return List<DistrictProject>.generate(count, (i) {
    final t = _projectTemplates[(seed * 3 + i * 7) % _projectTemplates.length];
    final scale = 0.6 + (seed % 8) * 0.05;
    return DistrictProject(
      id: nextId(),
      club: club,
      name: t.name,
      avenue: t.avenue,
      date: _projectDates[(seed * 2 + i * 5) % _projectDates.length],
      beneficiaries: (t.beneFactor * scale).round(),
      funds: (t.fundsFactor * scale).round(),
      manHours: t.hoursFactor + (seed % 3) * 8,
      status: _projectStatuses[(seed + i * 3) % _projectStatuses.length],
    );
  });
}

List<DistrictEvent> _makeEvents(String club, int seed, int Function() nextId) {
  final count = 1 + (seed % 3);
  return List<DistrictEvent>.generate(count, (i) {
    final t = _eventTemplates[(seed * 2 + i * 5) % _eventTemplates.length];
    return DistrictEvent(
      id: nextId(),
      club: club,
      name: t.name,
      type: t.type,
      date: _eventDates[(seed + i * 3) % _eventDates.length],
      time: _eventTimes[(seed * 3 + i) % _eventTimes.length],
      venue: _venues[(seed + i * 7) % _venues.length],
      status: _eventStatuses[(seed + i) % _eventStatuses.length],
    );
  });
}

List<int> _makeCriteria(ClubAnalytics club, int seed) {
  return List<int>.generate(kCitationCriteria.length, (i) {
    final maxPts = kCitationCriteria[i].points;
    final pctBase = club.citationScore / 1000.0;
    final raw = (maxPts * (pctBase + ((seed + i * 3) % 5) * 0.02 - 0.04)).round();
    return raw.clamp(0, maxPts);
  });
}

// ── Top-level exports ───────────────────────────────────────────────────

final List<ClubAnalytics> kClubAnalytics = <ClubAnalytics>[
  for (var i = 0; i < _highClubs.length; i++) _makeClub(_highClubs[i], 'high', i),
  for (var i = 0; i < _midClubs.length; i++)  _makeClub(_midClubs[i],  'mid',  i),
  for (var i = 0; i < _lowClubs.length; i++)  _makeClub(_lowClubs[i],  'low',  i),
];

final List<DistrictProject> kDistrictProjects = (() {
  var pid = 0;
  int nextId() => ++pid;
  final out = <DistrictProject>[];
  for (var i = 0; i < kClubAnalytics.length; i++) {
    out.addAll(_makeProjects(kClubAnalytics[i].name, i, nextId));
  }
  return out;
})();

final List<DistrictEvent> kDistrictEvents = (() {
  // Event IDs continue from where the prefix left off (matches React's
  // `let eid = 4` initial value).
  var eid = _districtEventsPrefix.length;
  int nextId() => ++eid;
  final out = <DistrictEvent>[..._districtEventsPrefix];
  for (var i = 0; i < kClubAnalytics.length; i++) {
    out.addAll(_makeEvents(kClubAnalytics[i].name, i, nextId));
  }
  return out;
})();

const List<CitationCriterion> kCitationCriteria = <CitationCriterion>[
  CitationCriterion(criterion: 'Membership Growth',       points: 200),
  CitationCriterion(criterion: 'Service Projects (≥10)',  points: 200),
  CitationCriterion(criterion: 'TRF Contribution',        points: 200),
  CitationCriterion(criterion: 'Attendance (≥75%)',       points: 200),
  CitationCriterion(criterion: 'Public Image Initiative', points: 200),
];

final List<ClubCitation> kClubCitations = <ClubCitation>[
  for (var i = 0; i < kClubAnalytics.length; i++)
    ClubCitation(
      id: kClubAnalytics[i].id,
      name: kClubAnalytics[i].name,
      total: kClubAnalytics[i].citationScore,
      max: kClubAnalytics[i].citationMax,
      criteria: _makeCriteria(kClubAnalytics[i], i),
    ),
];
