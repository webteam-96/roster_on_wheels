export type Governor = {
  name: string;
  district: string;
  mobile: string;
  email: string;
  photo: string;
};

/**
 * District Governors — real data from rotaryindia.org/District-Governor.aspx.
 * The live page defaults to Rotary year 2026-2027; GOVERNORS below is that
 * roster, verbatim, ordered by district number ascending (43 entries).
 */
export const DEFAULT_YEAR = "2026-2027";

/**
 * Rotary-year dropdown options exactly as they appear on the live page
 * (29 options, source order preserved — including 1980-1981 in second place).
 */
export const ROTARY_YEARS = [
  "2001-2002",
  "1980-1981",
  "2002-2003",
  "2003-2004",
  "2004-2005",
  "2005-2006",
  "2006-2007",
  "2007-2008",
  "2008-2009",
  "2009-2010",
  "2010-2011",
  "2011-2012",
  "2012-2013",
  "2013-2014",
  "2014-2015",
  "2015-2016",
  "2016-2017",
  "2017-2018",
  "2018-2019",
  "2019-2020",
  "2020-2021",
  "2021-2022",
  "2022-2023",
  "2023-2024",
  "2024-2025",
  "2025-2026",
  "2026-2027",
  "2027-2028",
  "2028-2029",
];

export const GOVERNORS: Governor[] = [
  { name: "Vaithianathan Krishnasamy", district: "2981", mobile: "9655008000", email: "vaithianathank@gmail.com", photo: "/images/dg/dg-2981.png" },
  { name: "Chinniah Senthil Kumar", district: "2982", mobile: "8124805166", email: "rtnsenthil2982@gmail.com", photo: "/images/dg/dg-2982.jpg" },
  { name: "Subramani Ramanujam", district: "3000", mobile: "7373723456", email: "rbsmani3000@gmail.com", photo: "/images/dg/dg-3000.png" },
  { name: "Ajeet Jalan", district: "3011", mobile: "9810133803", email: "ajeetjalan3011@gmail.com", photo: "/images/dg/dg-3011.jpg" },
  { name: "Amit Gupta", district: "3012", mobile: "9810456700", email: "cmd@kalco.in", photo: "/images/dg/dg-3012.png" },
  { name: "Sree Ramulu Guttikonda", district: "3020", mobile: "9848181274", email: "sriram.g5559@gmail.com", photo: "/images/dg/dg-3020.png" },
  { name: "Rajesh Vishwasrao Patil", district: "3030", mobile: "8975975757", email: "dr.rajeshpatil@gmail.com", photo: "/images/dg/dg-3030.jpg" },
  { name: "SANSKAR KOTHARI", district: "3040", mobile: "9425103608", email: "sanskarkothari@gmail.com", photo: "/images/dg/dg-3040.png" },
  { name: "BRIJ MOHAN AGARWAL", district: "3053", mobile: "9314012541", email: "brijmohanca@gmail.com", photo: "/images/dg/dg-3053.jpg" },
  { name: "Naimish N. Ravani", district: "3055", mobile: "7069016660", email: "naimish_ravani@yahoo.com", photo: "/images/dg/dg-3055.png" },
  { name: "Arun Bagadia", district: "3056", mobile: "9587000003", email: "arun@bestcapital.in", photo: "/images/dg/dg-3056.png" },
  { name: "Nilesh Rameshchandra Shah", district: "3060", mobile: "7069408373", email: "nileshdg2627@gmail.com", photo: "/images/dg/dg-3060.jpg" },
  { name: "Anil Kumar Singhal", district: "3070", mobile: "9814051143", email: "anilsinghal1954@gmail.com", photo: "/images/dg/dg-3070.png" },
  { name: "Rita Kalra", district: "3080", mobile: "9878880550", email: "rita.kalra5@gmail.com", photo: "/images/dg/dg-3080.jpg" },
  { name: "Amit Singla", district: "3090", mobile: "9876400701", email: "amitlalitca@gmail.com", photo: "/images/dg/dg-3090.png" },
  { name: "Payal Gaur", district: "3100", mobile: "8938888565", email: "payal.gaur86@gmail.com", photo: "/images/dg/dg-3100.jpg" },
  { name: "Jasbir Singh Bhatia", district: "3110", mobile: "9839084194", email: "cajsbhatia@gmail.com", photo: "/images/dg/dg-3110.png" },
  { name: "Poonam Gulati", district: "3120", mobile: "9721277555", email: "poonam.gulati312@gmail.com", photo: "/images/dg/dg-3120.png" },
  { name: "Nitin Sopanrao Dhamale", district: "3131", mobile: "9881471001", email: "ndhamale@gmail.com", photo: "/images/dg/dg-3131.jpg" },
  { name: "Jayesh Rameshbhai Patel", district: "3132", mobile: "9823562303", email: "jayeshpatel3@gmail.com", photo: "/images/dg/dg-3132.png" },
  { name: "Rajan Dua", district: "3141", mobile: "9004762626", email: "rajan.dua@dpbuildhomes.com", photo: "/images/dg/dg-3141.png" },
  { name: "Nilesh Vinayak Jaywant", district: "3142", mobile: "9819823839", email: "assureddentalcare@gmail.com", photo: "/images/dg/dg-3142.png" },
  { name: "Uday Sudhir Pilani", district: "3150", mobile: "8106508299", email: "udaypilani@gmail.com", photo: "/images/dg/dg-3150.jpg" },
  { name: "Pullalarevu Keshav Reddy", district: "3160", mobile: "9390299899", email: "dgkeshav3160@gmail.com", photo: "/images/dg/dg-3160.jpg" },
  { name: "Lenny Da Costa", district: "3170", mobile: "9823093675", email: "drlennydacosta@gmail.com", photo: "/images/dg/dg-3170.png" },
  { name: "Sathish Bolar", district: "3181", mobile: "9343352355", email: "sathishbolar@gmail.com", photo: "/images/dg/dg-3181.png" },
  { name: "Bandimut Manjunath Bhat", district: "3182", mobile: "9845243619", email: "mbhatbvr@gmail.com", photo: "/images/dg/dg-3182.png" },
  { name: "Anil Gupta", district: "3191", mobile: "9845028100", email: "anilgupta2809@gmail.com", photo: "/images/dg/dg-3191.png" },
  { name: "Ravishankar Dakoju", district: "3192", mobile: "9900926718", email: "ravi@harahousing.com", photo: "/images/dg/dg-3192.png" },
  { name: "Boopathi Kumarsamy", district: "3203", mobile: "9363354003", email: "boopathiavn@gmail.com", photo: "/images/dg/dg-3203.png" },
  { name: "Mohandas Menon Methile Veettil", district: "3204", mobile: "9447133505", email: "menonlic@gmail.com", photo: "/images/dg/dg-3204.png" },
  { name: "Joshy Chacko", district: "3205", mobile: "9846022537", email: "joshy_cm@yahoo.com", photo: "/images/dg/dg-3205.png" },
  { name: "Maruti Ramaswamy Shanmukam", district: "3206", mobile: "9600677111", email: "rsmaruti@gmail.com", photo: "/images/dg/dg-3206.jpg" },
  { name: "Krishnan G. Nair", district: "3211", mobile: "9847071387", email: "kgnrotary@gmail.com", photo: "/images/dg/dg-3211.png" },
  { name: "Gandhi Krishnan", district: "3212", mobile: "9442545555", email: "rtngandhikrishnan@gmail.com", photo: "/images/dg/dg-3212.png" },
  { name: "T. S. Ravikumar", district: "3231", mobile: "9944336600", email: "dg3231ravikumar2627@gmail.com", photo: "/images/dg/dg-3231.jpg" },
  { name: "Shriram Duvvuri", district: "3233", mobile: "9884110000", email: "shriramd3233@gmail.com", photo: "/images/dg/dg-3233.png" },
  { name: "Suresh D Jain", district: "3234", mobile: "9380000916", email: "suresh@kesar.in", photo: "/images/dg/dg-3234.jpg" },
  { name: "Asim Kanti Adhikary", district: "3240", mobile: "9564564088", email: "adhikary.a.k@gmail.com", photo: "/images/dg/dg-3240.jpg" },
  { name: "Anu Narang", district: "3250", mobile: "9334019545", email: "anunarang0101@gmail.com", photo: "/images/dg/dg-3250.jpg" },
  { name: "Alam Singh Roopra", district: "3261", mobile: "9437082821", email: "roopraalam@gmail.com", photo: "/images/dg/dg-3261.png" },
  { name: "Anil Kumar Samal", district: "3262", mobile: "9437031784", email: "dganil2627@gmail.com", photo: "/images/dg/dg-3262.png" },
  { name: "Tapas Bhattacharya", district: "3291", mobile: "9830503352", email: "tapas3291@gmail.com", photo: "/images/dg/dg-3291.jpg" },
];
