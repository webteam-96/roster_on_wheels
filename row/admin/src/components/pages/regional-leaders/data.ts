export type LeaderRow = {
  dist: string;
  name: string;
  /** Districts the leader supports / is assigned to (Zones 5-7). */
  supporting?: string;
  /** Year served as District Governor, e.g. "2022-23". */
  dgYear?: string;
};

export type SubTable = {
  /** Verbatim sub-role label rendered above the table (absent on single-table sections). */
  title?: string;
  rows: LeaderRow[];
};

export type SectionData = {
  id: string;
  /** Role-section heading. */
  title: string;
  subTables: SubTable[];
};

/** Tab labels — casing kept verbatim for the live zone tabs. */
export const ZONES = ["Zone 4", "zone 5", "zone 6", "zone 7"] as const;
export type Zone = (typeof ZONES)[number];

/** Regional & Assistant Regional Leaders 2026-27 — generated from the source Excel (all zones). */
export const SECTIONS_BY_ZONE: Record<Zone, SectionData[]> = {
  "Zone 4": [
    {
      id: "membership",
      title: "Membership",
      subTables: [
      {
        title: "Rotary Membership Co-Ordinator (RMC)",
        rows: [
        { dist: "3070", name: "PDG Dushyant Choudhary", dgYear: "2022-23" },
        ],
      },
      {
        title: "Plan Lead - Membership",
        rows: [
        { dist: "3056", name: "PDG Anil Agarwal", dgYear: "2013-14" },
        ],
      },
      {
        title: "Assistant Rotary Co-Ordinator (ARC)",
        rows: [
        { dist: "3011", name: "PDG Vinay Bhatia", dgYear: "2018-19" },
        { dist: "3141", name: "PDG Arun Bhargava", dgYear: "2023-24" },
        { dist: "3055", name: "PDG Mohan Parashar", dgYear: "2024-25" },
        { dist: "3056", name: "PDG Nirmal Kumar Singhvi", dgYear: "2006-07" },
        { dist: "3080", name: "PDG Rajpal Singh", dgYear: "2024-25" },
        { dist: "3053", name: "PDG Rahul Srivastav", dgYear: "2024-25" },
        ],
      },
      ],
    },
    {
      id: "public-image",
      title: "Public Image",
      subTables: [
      {
        title: "Regional Public Image Co-Ordinator (RPIC)",
        rows: [
        { dist: "3141", name: "PDG Subhash Kulkarni", dgYear: "2015-16" },
        ],
      },
      {
        title: "Assistant Regional Public Image Co-Ordinator (ARPIC)",
        rows: [
        { dist: "3060", name: "Rtr. Rtn. Rohit Ajmera" },
        { dist: "3080", name: "PDG Tarsem Kumar Ruby", dgYear: "2017-18" },
        { dist: "3090", name: "PDG Ghansham Kansal", dgYear: "2023-24" },
        { dist: "3053", name: "PDG Pawan Khandelwal", dgYear: "2023-24" },
        { dist: "3142", name: "PDG Chandu Kolvekar", dgYear: "2016-17" },
        { dist: "3011", name: "Rtn. Padmini Parameshwaran" },
        ],
      },
      ],
    },
    {
      id: "the-rotary-foundation",
      title: "The Rotary Foundation",
      subTables: [
      {
        title: "Regional Rotary Foundation Co-Ordinator (RRFC)",
        rows: [
        { dist: "3012", name: "Sharat Jain", dgYear: "2016-17" },
        ],
      },
      {
        title: "Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)",
        rows: [
        { dist: "3142", name: "PDG Dinesh Mehta", dgYear: "2024-25" },
        { dist: "3056", name: "PDG Dr. Nirmal Jain Kunawat", dgYear: "2023-24" },
        { dist: "3012", name: "PDG Ashok Aggarwal", dgYear: "2021-22" },
        { dist: "3070", name: "PDG Sunil Nagpal", dgYear: "2019-20" },
        { dist: "3060", name: "PDG Tushar Shah", dgYear: "2024-25" },
        { dist: "3141", name: "PDG Chetan Desai", dgYear: "2024-25" },
        ],
      },
      ],
    },
    {
      id: "emga",
      title: "E/MGA",
      subTables: [
      {
        title: "Endowment & Major Gifts Advisor (E/MGA)",
        rows: [
        { dist: "3060", name: "PDG Ashish Ajmera", dgYear: "2014-15" },
        ],
      },
      {
        title: "Assistant Endowment & Major Gifts Advisor (AE/MGA)",
        rows: [
        { dist: "3011", name: "PDG Ashok Kantoor", dgYear: "2022-23" },
        { dist: "3080", name: "PDG Arun Kumar Mongia", dgYear: "2023-24" },
        { dist: "3040", name: "PDG Col.Mahendra Mishra", dgYear: "2021-22" },
        { dist: "3053", name: "PDG Sanjay Malviya", dgYear: "2021-22" },
        { dist: "3090", name: "PDG Vijay Arora", dgYear: "2020-21" },
        { dist: "3142", name: "PDG Kailash Jethani", dgYear: "2022-23" },
        ],
      },
      ],
    },
    {
      id: "epnc",
      title: "EPNC",
      subTables: [
      {
        title: "End Polio Now Co-ordinator (EPNC)",
        rows: [
        { dist: "3141", name: "PDG Harjit Talwar", dgYear: "2019-20" },
        ],
      },
      {
        title: "Assistant End Polio Now Co-ordinator (AEPNC)",
        rows: [
        { dist: "3011", name: "PDG Sudhir Mangla", dgYear: "2015-16" },
        { dist: "3012", name: "PDG Prashant Raj Sharma", dgYear: "2024-25" },
        { dist: "3060", name: "PDG Santosh S Pradhan", dgYear: "2021-22" },
        { dist: "3142", name: "AKS DP Tripathi" },
        { dist: "3090", name: "PDG Rajender Taneja", dgYear: "2000-01" },
        { dist: "3056", name: "PDG Ratnesh Kashyap", dgYear: "2011-12" },
        ],
      },
      ],
    },
  ],
  "zone 5": [
    {
      id: "zonal-action-plan-champion",
      title: "Zonal Action Plan Champion",
      subTables: [
      {
        title: "Zonal Action Plan Champion",
        rows: [
        { dist: "3211", name: "PDG Rtn Shirish Kesavan", dgYear: "2019-20" },
        ],
      },
      {
        title: "Assistant Zonal Action Plan Champion (AZAPL)",
        rows: [
        { dist: "3205", name: "PDG Rtn Dr. Prakash Chandran Arackal", supporting: "3204, 3205 & 3211", dgYear: "2016-17" },
        { dist: "2982", name: "PDG Rtn KS Venkatesh", supporting: "2981, 2982, 3203 &3220" },
        { dist: "3231", name: "PDG Rtn Bharanitharan", supporting: "3231,3233 & 3234", dgYear: "2023-24" },
        { dist: "3000", name: "PDG Rtn RVN Kannan", supporting: "3000, 3206 & 3212", dgYear: "2018-19" },
        ],
      },
      ],
    },
    {
      id: "the-rotary-foundation",
      title: "The Rotary Foundation",
      subTables: [
      {
        title: "Regional Rotary Foundation Co-Ordinator (RRFC)",
        rows: [
        { dist: "3234", name: "PDG Rtn J Sridhar (Sridhar Jagannathan)", dgYear: "2021-22" },
        ],
      },
      {
        title: "Plan Lead - Foundation",
        rows: [
        { dist: "3206", name: "PDG Rtn A Venkatachalapathy", dgYear: "2018-19" },
        ],
      },
      {
        title: "Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)",
        rows: [
        { dist: "2981", name: "PDG Rtn Balaji (S. Balaji)", supporting: "2981& 3203", dgYear: "2021-22" },
        { dist: "3231", name: "PDG Rtn JKN Palani", supporting: "3231 & 2982", dgYear: "2022-23" },
        { dist: "3206", name: "PDG Rtn Rajasekar", supporting: "3206 & 3220" },
        { dist: "3212", name: "PDG Rtn Meerankhan Saleem", supporting: "3212 & 3000" },
        { dist: "3211", name: "PDG Rtn Sudhi Jabbar", supporting: "3204, 3205 & 3211" },
        { dist: "3234", name: "PDG Rtn Saravanan", supporting: "3233 & 3234", dgYear: "2024-25" },
        ],
      },
      ],
    },
    {
      id: "membership",
      title: "Membership",
      subTables: [
      {
        title: "Rotary Membership Co-Ordinator (RMC)",
        rows: [
        { dist: "3000", name: "PDG Rtn Y Kumanan", dgYear: "2012-13" },
        ],
      },
      {
        title: "Plan Lead - Membership",
        rows: [
        { dist: "2981", name: "PDG Rtn A Mani", dgYear: "2016-17" },
        ],
      },
      {
        title: "Assistant Rotary Membership Co-Ordinator (ARMC)",
        rows: [
        { dist: "3000", name: "PDG Rtn Anandtha Jothi", supporting: "3000 & 3206", dgYear: "2023-24" },
        { dist: "2981", name: "PDG Rtn Balaji Babu", supporting: "2981 & 3231", dgYear: "2020-21" },
        { dist: "3212", name: "PDG Rtn Muthiah Pillai", supporting: "3212 & 3220", dgYear: "2023-24" },
        { dist: "3205", name: "PDG Rtn Rajmohan Nair", supporting: "3204, 3205 & 3211", dgYear: "2022-23" },
        { dist: "2982", name: "PDG Rtn Sivakumar", supporting: "2982 & 3203", dgYear: "2024-25" },
        { dist: "3233", name: "PDG Rtn Nandakumar", supporting: "3233 & 3234", dgYear: "2022-23" },
        ],
      },
      ],
    },
    {
      id: "public-image",
      title: "Public Image",
      subTables: [
      {
        title: "Regional Public Image Co-Ordinator (RPIC)",
        rows: [
        { dist: "2981", name: "PDG Rtn Ramesh Babu", dgYear: "2017-18" },
        ],
      },
      {
        title: "Plan Lead - Public Image and Communication",
        rows: [
        { dist: "3233", name: "PDG Rtn Srinivasan", dgYear: "2017-18" },
        ],
      },
      {
        title: "Assistant Regional Public Image Co-Ordinator (ARPIC)",
        rows: [
        { dist: "2982", name: "PDG Rtn Senguttuvan", supporting: "2981 & 3231", dgYear: "2023-24" },
        { dist: "3220", name: "PDG Rtn Dushan Soza", supporting: "3212 & 3220", dgYear: "2018-19" },
        { dist: "3000", name: "PDG Rtn I Jerald", supporting: "3000 & 2982", dgYear: "2022-23" },
        { dist: "3203", name: "PDG Rtn Shanmugasundaram", supporting: "3203 & 3206", dgYear: "2021-22" },
        { dist: "3204", name: "PDG Rtn Pramod Nayanar", supporting: "3204, 3205 & 3211", dgYear: "2022-23" },
        { dist: "3234", name: "PDRR Rtr Sasi", supporting: "3233 & 3234" },
        ],
      },
      ],
    },
    {
      id: "emga",
      title: "E/MGA",
      subTables: [
      {
        title: "Endowment & Major Gifts Advisor (E/MGA)",
        rows: [
        { dist: "3203", name: "PDG Rtn Aruljothi Karthikeyan", dgYear: "2019-20" },
        ],
      },
      {
        title: "Assistant Endowment & Major Gifts Advisor (AE/MGA)",
        rows: [
        { dist: "3234", name: "PDG Rtn Ravi Raman", supporting: "3203 & 3206", dgYear: "2023-24" },
        { dist: "3220", name: "PDG Rtn Sushena Ranatunga", supporting: "3220 & 3212", dgYear: "2024-25" },
        { dist: "3231", name: "PDG Rtn Rajan Babu", supporting: "3231 & 2982", dgYear: "2024-25" },
        { dist: "3234", name: "PDG Rtn Mahaveer Chand Bothra", supporting: "3233 & 3234", dgYear: "2024-25" },
        { dist: "3211", name: "PDG Rtn Dr. G Sumithran", supporting: "3204, 3205 & 3211", dgYear: "2023-24" },
        { dist: "2981", name: "PDG Rtn Piraiyon", supporting: "2981 & 3000", dgYear: "2018-19" },
        ],
      },
      ],
    },
    {
      id: "epnc",
      title: "EPNC",
      subTables: [
      {
        title: "End Polio Now Co-ordinator (EPNC)",
        rows: [
        { dist: "3000", name: "PDG Rtn Raja Govindasamy Ramakrishnan", dgYear: "2024-25" },
        ],
      },
      {
        title: "Assistant End Polio Now Co-ordinator (AEPNC)",
        rows: [
        { dist: "3231", name: "PDG Rtn Pandian", supporting: "3231 &3233", dgYear: "2020-21" },
        { dist: "3203", name: "PDG Rtn Dr Sundararajan", supporting: "3203&3206", dgYear: "2023-24" },
        { dist: "3212", name: "PDG Rtn Raja Gopalan", supporting: "3000 & 3212", dgYear: "2018-19" },
        { dist: "2982", name: "PDG Rtn Dharmesh R Patel", supporting: "2982 & 3234", dgYear: "2017-18" },
        { dist: "3204", name: "PDG Rtn Sridhar Nambiar", supporting: "3204, 3205 & 3211", dgYear: "2014-15" },
        ],
      },
      ],
    },
    {
      id: "plan-lead-polio",
      title: "Plan Lead - Polio",
      subTables: [
      {
        rows: [
        { dist: "3000", name: "PDG Rtn Raja Govindasamy Ramakrishnan", dgYear: "2024-25" },
        ],
      },
      ],
    },
  ],
  "zone 6": [
    {
      id: "zonal-action-plan-champion",
      title: "Zonal Action Plan Champion",
      subTables: [
      {
        title: "Zonal Action Plan Champion",
        rows: [
        { dist: "3291", name: "PDG Rtn Angsuman Bandyopadhyay" },
        ],
      },
      {
        title: "Assistant Zonal Action Plan Champion (AZAPL)",
        rows: [
        { dist: "3030", name: "Mahesh H Mokalkar" },
        { dist: "3262", name: "Jayashree Mohanty" },
        { dist: "3292", name: "Kiran Lal Shrestha" },
        ],
      },
      ],
    },
    {
      id: "the-rotary-foundation",
      title: "The Rotary Foundation",
      subTables: [
      {
        title: "Regional Rotary Foundation Co-Ordinator (RRFC)",
        rows: [
        { dist: "3120", name: "Dr. Pramod Kumar", supporting: "All districts of the zone" },
        ],
      },
      {
        title: "Plan Lead - Foundation",
        rows: [
        { dist: "3262", name: "PDG Debasish Mishra" },
        ],
      },
      {
        title: "Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)",
        rows: [
        { dist: "3030", name: "Anand Ashok Jhunjhunuwala", supporting: "3030, 3100" },
        { dist: "3250", name: "Jogesh Gambhir", supporting: "3250, 3262" },
        { dist: "3240", name: "Mohan Shyam Konwar", supporting: "3240, 3291" },
        { dist: "3250", name: "Mithilesh Kumar Jha (MK Jha)", supporting: "3292" },
        { dist: "3262", name: "Shashi Varvandkar", supporting: "3261" },
        ],
      },
      ],
    },
    {
      id: "membership",
      title: "Membership",
      subTables: [
      {
        title: "Rotary Membership Co-Ordinator (RMC)",
        rows: [
        { dist: "3292", name: "Sanjay Giri", supporting: "All districts of the zone" },
        ],
      },
      {
        title: "Assistant Rotary Membership Co-Ordinator (ARMC)",
        rows: [
        { dist: "3030", name: "Rajendra Madhukar Bhamre", supporting: "3030, 3250" },
        { dist: "3261", name: "Shashank Rastogi", supporting: "3261, 3100" },
        { dist: "3240", name: "Udaya M. Pradhan", supporting: "3240, 3292" },
        { dist: "3120", name: "Paritosh Bajaj", supporting: "3291, 3120" },
        { dist: "3110", name: "Neerav Nimesh Agrawal", supporting: "3110, 3262" },
        ],
      },
      ],
    },
    {
      id: "public-image",
      title: "Public Image",
      subTables: [
      {
        title: "Regional Public Image Co-Ordinator (RPIC)",
        rows: [
        { dist: "3250", name: "Bindu Singh", supporting: "All districts of the zone" },
        ],
      },
      {
        title: "Plan Lead - Public Image and Communication",
        rows: [
        { dist: "3240", name: "PDG Rtn Subashish Chatterjee" },
        ],
      },
      {
        title: "Assistant Regional Public Image Co-Ordinator (ARPIC)",
        rows: [
        { dist: "3120", name: "Uttam Kumar Agrawal", supporting: "3261, 3100" },
        { dist: "3240", name: "Nilesh Kumar Agarwal", supporting: "3110, 3250" },
        { dist: "3291", name: "Prabir Chatterjee", supporting: "3030, 3292" },
        { dist: "3261", name: "Sunil D. Phatak", supporting: "3120, 3262" },
        { dist: "3262", name: "Yagyansis Mohapatra", supporting: "3240, 3291" },
        ],
      },
      ],
    },
    {
      id: "emga",
      title: "E/MGA",
      subTables: [
      {
        title: "Endowment & Major Gifts Advisor (E/MGA)",
        rows: [
        { dist: "3110", name: "Pawan Agarwal", supporting: "All districts of the zone" },
        ],
      },
      {
        title: "Assistant Endowment & Major Gifts Advisor (AE/MGA)",
        rows: [
        { dist: "3292", name: "Rajendra Prasad Dhoju", supporting: "3292" },
        { dist: "3261", name: "Ranjeet Singh Saini", supporting: "3261" },
        { dist: "3240", name: "Chandu Kumar Agarwal", supporting: "3240" },
        { dist: "3262", name: "Pravudutta Subudhi", supporting: "3120, 3250" },
        { dist: "3291", name: "Dr. Krishnendu Gupta", supporting: "3262, 3291" },
        ],
      },
      ],
    },
    {
      id: "epnc",
      title: "EPNC",
      subTables: [
      {
        title: "End Polio Now Co-ordinator (EPNC)",
        rows: [
        { dist: "3291", name: "Uttam Ganguli", supporting: "All districts of the zone" },
        ],
      },
      ],
    },
    {
      id: "plan-lead-polio",
      title: "Plan Lead - Polio",
      subTables: [
      {
        rows: [
        { dist: "3261", name: "PDG Rtn Major Deepak Mehta" },
        ],
      },
      ],
    },
  ],
  "zone 7": [
    {
      id: "membership",
      title: "Membership",
      subTables: [
      {
        title: "Rotary Membership Co-Ordinator (RMC)",
        rows: [
        { dist: "3131", name: "PDG Dr. Deepak M Purohit", dgYear: "2013-14" },
        ],
      },
      {
        title: "Plan Lead - Membership",
        rows: [
        { dist: "3192", name: "PDG S Nagendra", supporting: "Zone 7", dgYear: "2011-12" },
        ],
      },
      {
        title: "Assistant Rotary Co-Ordinator (ARC)",
        rows: [
        { dist: "3181", name: "PDG K. Krishna Shetty", supporting: "3182", dgYear: "2008-09" },
        { dist: "3150", name: "Rtn. Thansen", supporting: "3170" },
        { dist: "3020", name: "PDG M Rama Rao", supporting: "3160", dgYear: "2021-22" },
        { dist: "3131", name: "PDG Manjoo Phadke", supporting: "3132", dgYear: "2023-24" },
        { dist: "3192", name: "PDG V. Srinivas Murthy", supporting: "3191", dgYear: "2023-24" },
        ],
      },
      ],
    },
    {
      id: "public-image",
      title: "Public Image",
      subTables: [
      {
        title: "Regional Public Image Co-Ordinator (RPIC)",
        rows: [
        { dist: "3182", name: "PDG Abhinandan A Shetty", dgYear: "2018-19" },
        ],
      },
      {
        title: "Assistant Regional Public Image Co-Ordinator (ARPIC)",
        rows: [
        { dist: "3170", name: "PDG Dr. Pranesh Jahagirdar", supporting: "3132", dgYear: "2008-09" },
        { dist: "3150", name: "PDG Sharath Choudhary K", supporting: "3020", dgYear: "2024-25" },
        { dist: "3192", name: "Rtr. Rtn. Janice Philip", supporting: "3160" },
        { dist: "3181", name: "PDG N. Prakash Karanth", supporting: "3182", dgYear: "2022-23" },
        { dist: "3191", name: "PDG Satish Madhavan", supporting: "3131", dgYear: "2024-25" },
        ],
      },
      ],
    },
    {
      id: "the-rotary-foundation",
      title: "The Rotary Foundation",
      subTables: [
      {
        title: "Regional Rotary Foundation Co-Ordinator (RRFC)",
        rows: [
        { dist: "3160", name: "PDG Bommireddy Surendra", dgYear: "2006-07" },
        ],
      },
      {
        title: "Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)",
        rows: [
        { dist: "3170", name: "PDG Sangram V Patil", supporting: "3131", dgYear: "2020-21" },
        { dist: "3132", name: "PDG Dr. Deepak Pophale", supporting: "3182", dgYear: "2015-16" },
        { dist: "3160", name: "PDG Thirupathi V Naidu", supporting: "3191", dgYear: "2021-22" },
        { dist: "3192", name: "PDG Jeetendra Aneja", supporting: "3181", dgYear: "2022-23" },
        { dist: "3020", name: "PDG Bhasker Ram Viswanatham", supporting: "3150", dgYear: "2022-23" },
        ],
      },
      ],
    },
    {
      id: "emga",
      title: "E/MGA",
      subTables: [
      {
        title: "Endowment & Major Gifts Advisor (E/MGA)",
        rows: [
        { dist: "3150", name: "PDG Dr.Sharat Babu Chilukuri", dgYear: "2008-09" },
        ],
      },
      {
        title: "Assistant Endowment & Major Gifts Advisor (AE/MGA)",
        rows: [
        { dist: "3020", name: "PDG Subbarao Ravuri(Datta)", supporting: "3150", dgYear: "2023-24" },
        { dist: "3131", name: "PDG Shital Sharad Shah", supporting: "3132", dgYear: "2024-25" },
        { dist: "3170", name: "PDG Sharad Pai", supporting: "3191", dgYear: "2024-25" },
        { dist: "3182", name: "PDG B. Rajaram Bhat", supporting: "3181", dgYear: "2020-21" },
        { dist: "3192", name: "PDG K S Nagendra", supporting: "3160", dgYear: "2013-14" },
        ],
      },
      ],
    },
    {
      id: "epnc",
      title: "EPNC",
      subTables: [
      {
        title: "End Polio Now Co-ordinator (EPNC)",
        rows: [
        { dist: "3020", name: "PDG Sam Movva", dgYear: "2002-03" },
        ],
      },
      {
        title: "Assistant End Polio Now Co-ordinator (AEPNC)",
        rows: [
        { dist: "3020", name: "PDG Jagadeeswara Rao Maddu", supporting: "3150", dgYear: "2015-16" },
        { dist: "3181", name: "PDG.Dr.R.S.Nagarjuna", supporting: "3182", dgYear: "2016-17" },
        { dist: "3132", name: "PDG Pramod Shashikant Parikh", supporting: "3131", dgYear: "2016-17" },
        { dist: "3170", name: "PDG Nasir H. Borsadwala", supporting: "3160", dgYear: "2023-24" },
        { dist: "3191", name: "Rtn. Deepak Srinivas", supporting: "3192" },
        ],
      },
      ],
    },
  ],
};
