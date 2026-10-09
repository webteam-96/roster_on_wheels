import type { ReactNode } from "react";

/**
 * Ground-truth leader profiles from rotaryindia.org/OurLeaders.aspx.
 * Names, designations, biographies and button links are verbatim from the live
 * page (including original spellings/casing). Biodata PDFs and the one video
 * that is a hosted MP4 link absolutely to rotaryindia.org; portraits are local.
 */
export type LeaderProfileData = {
  /** Editorial index numeral (design chrome). */
  index: string;
  name: string;
  /** Nickname line rendered under the name (e.g. "(Venky)"). */
  nick?: string;
  /** Designation lines, verbatim. */
  roles: string[];
  /** Zone parenthetical, verbatim (rendered as a chip). */
  zone?: string;
  photo: string;
  /** "Biodata" PDF (some leaders have none yet). */
  biodata?: string;
  /** "Video Introduction" link (two leaders have Biodata only). */
  video?: string;
  /** Full verbatim biography paragraphs. */
  bio: ReactNode;
};

export const CURRENT_LEADERS: LeaderProfileData[] = [
  {
    index: "01",
    name: "Bharat Pandya",
    roles: ["Rotary International President Nominee 2028-29"],
    photo: "/images/leaders/bharat-pandya.png",
    bio: (
      <>
        <p>
          Bharat Pandya, a member of the Rotary Club of Borivli, Mumbai, India, will serve
          as the <b>President of Rotary International for the year 2028–29</b>.
        </p>
        <p>
          After receiving undergraduate and postgraduate degrees from Seth G. S. Medical
          College and King Edward Memorial Hospital in Mumbai, Pandya practiced as a general
          and laparoscopic surgeon for 38 years. Among other professional recognitions, he
          was awarded fellowships by the Association of Surgeons of India and the
          International College of Surgeons and earned the Borivli Medical Brotherhood’s
          Outstanding Performance Award. He is a founding member of the Association of
          Minimal Access Surgeons of India and was a board member and vice chair of Jan
          Shikshan Sansthan, a government-sponsored vocational training and skill development
          institute. He received the Mumbai Gaurav (Pride of Mumbai) Award from Sanskriti
          Yuva Sanstha and the Indian Global Foundation.
        </p>
        <p>
          Pandya has served as an RI director and treasurer and on numerous committees,
          among them the Finance Committee and the Strategic Planning Committee. He has
          served in multiple positions for The Rotary Foundation: trustee, vice chair,
          Executive Committee chair, and vice chair of the Finance and Stewardship
          committees. He is currently chair of the RI Programs Committee and vice chair of
          The Rotary Foundation Programs Committee. He served on the India PolioPlus
          Committee in 2011-15, during which time India was certified polio-free.
        </p>
        <p>
          Pandya and his wife, Madhavi, a past district chair of Inner Wheel District 314,
          are Major Donors and Benefactors. They have two daughters and one granddaughter.
        </p>
      </>
    ),
  },
  {
    index: "02",
    name: "PRID A.S.Venkatesh",
    nick: "(Venky)",
    roles: ["Trustee 2026-30"],
    photo: "/images/leaders/venky.png",
    biodata: "https://rotaryindia.org/assets/images/team/A.S._Venkatesh.pdf",
    video: "https://youtu.be/kl-Zw3k7toI",
    bio: (
      <>
        <p>
          After earning an engineering degree from the Indian Institute of Technology Madras
          and an MBA from Indian Institute of Management Ahmedabad, Ananthanarayanan S.
          Venkatesh entered civil construction at age 23. He now leads a firm that employs
          more than 1,400 people.
        </p>
        <p>
          Known in Rotary as “Venky,” Venkatesh joined in 1999, initially for networking and
          friendship. But during his first service project, a conversation with a young girl
          transformed his perspective. His club had donated benches to a school, and he
          noticed one girl sitting alone.
        </p>
        <p>
          “I asked her why she wouldn’t budge, and she told me that this was the first time
          in her life she was sitting on a bench and not on the ground,” Venkatesh says.
          “That changed my entire perspective of what I wanted to do in Rotary.”
        </p>
        <p>
          Since then, he has championed literacy and the empowerment of girls and women. “By
          educating a girl, we’re educating a family and generations thereafter,” Venkatesh
          says. “The return on investment is very high.”
        </p>
        <p>
          Venkatesh has played a key role in the India Literacy Mission as joint secretary
          and national executive committee member, supporting teacher training and literacy
          programs across 2,964 schools. He has also served as director of two Rotary Action
          Groups.
        </p>
        <p>
          Venkatesh served as RI director from 2021 to 2023 and as treasurer in 2022-23. He
          has also served as Rotary membership coordinator and learning facilitator. A
          frequent speaker at presidents-elect learning seminars and club leadership learning
          seminars, Venkatesh has attended more than 10 Rotary International Conventions and
          chaired the South Asian receptions at the conventions in Montreal and Seoul.
        </p>
        <p>
          Venkatesh is passionate about the connection between Rotary’s public image and
          membership growth. “One day, people will ask us more often ‘Can I join Rotary?’
          rather than us going around asking ‘Will you join Rotary?’”
        </p>
        <p>
          For Venkatesh, part of Rotary’s appeal comes from how it affords its members a
          streamlined way to make an impact. “Rotary gives me a conduit, a platform, and an
          organized set-up where not only do I give back to the community, but my
          contribution becomes manifold when it reaches the community,” he says. “It’s a
          multiplier.”
        </p>
        <p>
          Venkatesh enjoys competitive bridge and traveling to Malaysia and seaside
          destinations. His wife, Vinita, is a member of the Rotary Club of Chennai
          Anchorage. They are Major Donors to The Rotary Foundation.
        </p>
      </>
    ),
  },
  {
    index: "03",
    name: "K. P. Nagesh",
    roles: ["Rotary International Director 2025-27"],
    zone: "(Zone 4 & 7)",
    photo: "/images/leaders/k-p-nagesh.jpg",
    biodata: "https://rotaryindia.org/assets/images/team/Nagesh-Profile-2024.pdf",
    video: "https://youtu.be/FnUhrlXpLw4",
    bio: (
      <>
        <p>
          Flt. Lt. K.P. Nagesh is a self-made entrepreneur, educator, and social activist
          hailing from Ramanagara District in Karnataka, India. He graduated in mechanical
          engineering and joined the Indian Air Force as a Short Service Commission Officer
          in 1988. The Air Force instilled in him the values of commitment, dedication,
          discipline, and time management, which have contributed to his success as a leader.
        </p>
        <p>
          Nagesh founded UNIQ Security Solutions as a result of his entrepreneurial spirit
          and leadership skills. Over 10,000 people were employed by this start-up, which
          later became the industry leader and had more than 500 clients in South India. He
          also established Uniq Skill Development Academy in Channapatna, Ramanagara
          District. This state-of-the-art, one-of-a-kind facility is devoted to providing
          vocational training to rural youth so they can find employment opportunities with
          the Indian Uniform services and Corporate Companies.
        </p>
        <p>
          In the year 2015-16, Nagesh served as the District Governor of Rotary International
          District 3190, where he set unprecedented records in membership growth, the highest
          growth of women and youth members, and contributions to the Rotary Foundation. His
          leadership made him the number one performing District Governor in the world.
          District 3190 was also regarded as the number one district for the year. Rotary
          International recognized his talent and appointed him as the Asst Regional Rotary
          Foundation Coordinator (ARRFC) for 2016-17 and as the Endowment and Major Gifts
          Advisor for 2017-18.
        </p>
      </>
    ),
  },
  {
    index: "04",
    name: "M. Muruganandam",
    roles: ["RI Vice President 2026–27", "Rotary International Director 2025-27"],
    zone: "(Zone 5 & 6)",
    photo: "/images/leaders/Muruganandam-new1.jpg",
    biodata: "https://rotaryindia.org/assets/images/team/rid-mmm-biodata.pdf",
    video: "https://youtu.be/sY08oBIbEUM",
    bio: (
      <>
        <p>
          Muruganandam M , affectionately called <b>MMM</b> (Triple M), is a Chartered
          Engineer with 3 decades of experience in Supply Chain Management. He is the
          Chairman of the Excel Group of Companies which comprises diverse businesses such as
          Maritime & Shipping Logistics, EXIM Services, HR, Job Portal, Tours and Events,
          Trading, Infra, Energy Sectors, Agro Farming, Healthcare and Renewable Power
          Projects.
        </p>
        <p>
          His educational qualifications are Industrial Engineering from IIIE Mumbai, MS from
          BITS Pilani, MBA in Finance in IGNOU and Master of Foreign Trade from Pondicherry
          University.
        </p>
        <p>
          MMM was recognised as one of the <b>Top 20 Most Inspiring Business Leaders</b> by
          The CEO Magazine. His Excel Maritime & Logistics has received accolades like{" "}
          <b>The Best Navigator</b> (2012), by Times Group,{" "}
          <b>Best Project Cargo Mover and C & F Agent</b>, by Shipping Times of India,{" "}
          <b>Top 10 Most Promising Companies in Logistics,</b> Silicon Magazine,{" "}
          <b>Best CSR by an Indian SME</b> in the Economic Times MSME Awards 2022,{" "}
          <b>Project Cargo Mover</b> of the Year 2022 by Shipping Times and{" "}
          <b>Top 10 Most Successful Logistics Brands 2023</b> by The Leaders Globe Magazine.
        </p>
        <p>
          He holds a Lifetime Membership in prominent industrial engineering and renowned
          maritime and logistics forums. He is a proud alumnus of BITS Pilani and a member of
          the Trichy Rifle Club. MMM has emerged as a very successful entrepreneur,
          philanthropist and passionate Rotarian.
        </p>
        <p>
          With <b>&quot;SAY YES TO ROTARY&quot;</b>, as his mantra, MMM began his Rotary
          journey as a Rotaractor at the age of 16. Не won the{" "}
          <b>Outstanding DRR of the World,</b> became the Charter President of the Rotary
          Club of BHEL City Tiruchirappalli in 2008-09, and was elected as one of the
          youngest governors of RI District 3000 in 2016-17. MMM is known as{" "}
          <b>the Guinness Governor</b> for accomplishing 8 Guinness World Records
          commemorating TRF&apos;s centennial year and he led the TRF Centennial Summit which
          was presided over by RI President lan Riseley. By chartering{" "}
          <b>99 Rotaracts, 250 Interacts and 100 RCCs,</b> he topped in Youth Service at the
          world level and bagged zonal awards for Membership Development, Public Image and
          contribution to the Rotary Foundation.
        </p>
      </>
    ),
  },
  {
    index: "05",
    name: "PRID Anirudha Roy Chowdhury",
    roles: ["Chairman, Rotary Foundation India (RFI)"],
    photo: "/images/leaders/anirudha-roy-chowdhury.jpg",
    biodata: "/pdf/Anirudha-Roy-Chowdhury-Biodata.pdf",
    video: "/videos/anirudha-roy-chowdhury-intro.mp4",
    bio: (
      <>
        <p>
          <b>Anirudha Roy Chowdhury</b>, RI Director 2023–25 and a member of the Rotary Club
          of Calcutta Megacity, is an electrical engineer and first generation entrepreneur,
          employs more than 250 people and specializes in digital imaging, 3D printing for
          medical applications, and large format printing. Anirudha’s enterprises also span
          other business segments including healthcare diagnostics, and pharmacies.
        </p>
        <p>
          Anirudha joined Rotary as a charter member of RC Calcutta Metro City in 1994 &amp;
          become district governor in 2007–08, the unified RI District 3290 (India/Nepal).
          During his Governorship he added 450 members with 11 new clubs. He raised fund for
          TRF of <b>US$613,000</b> which is a record till date of his district. He has since
          served RI as Regional coordinator for six years. He has represented as RI
          president’s representative in seven times and attended seven RI Conventions.
          Currently, he is also a member of The Rotary Foundation’s Cadre of Technical
          Advisers and the board of trustees of Rotary Foundation India (RFI).
        </p>
        <p>
          He is Passionate about promoting literacy through Rotary, he is serving as a member
          of the executive body of the <b>Rotary India Literacy Mission</b> since inception,
          which provides free digital contents, targeting 27 million School students, and now
          working towards Adult Literacy to free India from the scourge of low literacy rate.
        </p>
        <p>
          Anirudha says he is eager to take the next step in Rotary leadership as a director,
          but he believes that it is important to stay humble. “At the end of the day, I am
          just a Rotarian, and my passion is to serve the community in the capacity I can,”
          he says. “We are all working with the same objectives in mind.”
        </p>
        <p>
          Anirudha has been active in regional business organizations including Bengal
          National Chambers of Commerce, the Federation of Small and Medium Industry, and the
          Calcutta Chamber of Commerce, where he currently serves as a board member. He also
          established the Zoom Foundation, which promotes health causes such as funding a
          hematology diagnostic center to treat children with Thalassemia and many other
          meaningful service areas.
        </p>
        <p>
          Anirudha is a recipient of RI’s Service above Self Award as well as The Rotary
          Foundation’s Citation for Meritorious Services and the Distinguished Service Award.
          He and his spouse, Shipra, support the Foundation as Level Three Major Donors and
          member of Bequest Society.
        </p>
        <p>
          His famous quote is: <b>“Embrace each dawn with open heart &amp; thanksgiving &amp;
          enjoy the day as you are eternal &amp; infinite”</b>
        </p>
      </>
    ),
  },
  {
    index: "06",
    name: "Gurjeet Singh Sekhon",
    roles: ["Rotary International Director 2027-29"],
    zone: "(Zone 4 & 7)",
    photo: "/images/leaders/gurjeet-singh.jpg",
    biodata: "https://rotaryindia.org/assets/images/team/Gurjeet-S-Sekhon.pdf",
    video: "https://youtu.be/Xt4UA_kVmW0",
    bio: (
      <>
        <p>
          Gurjeet S. Sekhon is a distinguished professional with over three decades of
          experience spanning agriculture, marketing, information technology, and leadership
          coaching. Known for his exceptional analytical skills and deep expertise in data
          interpretation, he has made significant contributions to IT education and the
          travel industry, earning recognition from the Government of Punjab for his
          outstanding service.
        </p>
        <p>
          A passionate Rotarian since 1994, Gurjeet is a member of Rotary Club Amritsar Civil
          Lines. He has served in numerous leadership capacities, including District Governor
          (2014–15), Rotary Coordinator for Zone 4 & Rotary India (2019–23), and currently as
          the Action Plan Champion for Zone 4. His leadership has influenced communities
          across more than twenty Rotary districts in India and internationally.
        </p>
        <p>
          He has demonstrated remarkable commitment to Rotary training and development,
          serving as Chairman of the Governor Nominee Training Seminar (2023) and Governor
          Elect Learning Seminar (2025). He also served as a Facilitator at the Regional
          Leaders Training Institute in 2021 and as an International Learning Facilitator at
          the International Assembly in Orlando in 2024 and 2025.
        </p>
        <p>
          Gurjeet is an internationally certified Marshal Goldsmith Leadership and Life
          Coach, strengthening his ability to mentor, empower, and inspire leaders worldwide.
        </p>
        <p>
          He was unanimously elected as <b>Rotary International Director for 2027–29</b>,
          representing <b>Zones 4 & 7</b>, one of the highest leadership roles within Rotary
          International.
        </p>
        <p>
          His contributions have been honoured with several distinguished recognitions,
          including the <b>Service Above Self Award</b> and the{" "}
          <b>Rotary Foundation Citation for Meritorious Service.</b>
        </p>
        <p>
          At heart, Gurjeet finds his greatest joy in family—his wife,{" "}
          <b>Rotarian Past President Amandeep</b>, and their daughter, <b>Mannat.</b>
        </p>
        <p>
          Guided by Rotary’s core principle, “Service Above Self,” Gurjeet S. Sekhon
          continues to dedicate his life to leadership excellence, community service, and
          global impact.
        </p>
      </>
    ),
  },
  {
    index: "07",
    name: "Basu Dev Golyan",
    roles: ["Rotary International Director 2027-29"],
    zone: "(Zone 5 & 6)",
    photo: "/images/leaders/basu-dev.png",
    biodata: "https://rotaryindia.org/assets/images/team/Basu_Dev_Golyan_Biodata.pdf",
    video: "https://rotaryindia.org/assets/images/team/Basu_Dev_Golyan_Intro.mp4",
    bio: (
      <>
        <p>
          Mr. Basu Dev Golyan is a distinguished industrialist, visionary humanitarian, and
          globally respected Rotary leader whose life journey reflects an unwavering
          commitment to service, leadership, and nation-building. Born into a values-driven
          family rooted in integrity, compassion, and entrepreneurship, he developed strong
          leadership qualities and a deep sense of social responsibility from an early age.
          These formative values shaped his lifelong dedication to ethical business
          practices, community upliftment, and humanitarian service.
        </p>
        <p>
          As the Chairman of the Golyan Group of Industries, Mr. Golyan has played a pivotal
          role in expanding and strengthening one of Nepal’s leading business conglomerates.
          Under his dynamic leadership, the group has diversified across banking, insurance,
          manufacturing, hydropower, renewable energy, hospitality, exports, and sustainable
          agriculture. His leadership philosophy emphasizes innovation, responsible
          governance, long-term sustainability, and inclusive economic growth. Through his
          strategic vision and entrepreneurial excellence, he has significantly contributed
          to Nepal’s industrial development and employment generation while promoting
          sustainable and socially responsible initiatives.
        </p>
        <p>
          Mr. Golyan’s Rotary journey began in the late 1980s and has since evolved into
          decades of dedicated and impactful service. Rising through various leadership
          roles, he served as District Governor of RI District 3292 in 2011–2012, where he
          strengthened the district’s global presence and expanded Rotary’s reach to Bhutan.
          During his governorship, he successfully organized the first Rotary International
          Literacy Summit in Nepal, reinforcing his enduring commitment to literacy,
          education, and peace-building. His leadership during times of crisis has included
          large-scale disaster relief initiatives, distribution of shelters for flood and
          earthquake victims, and numerous humanitarian and health camps that have benefited
          thousands of underserved families.
        </p>
      </>
    ),
  },
];

export const PAST_PRESIDENTS: LeaderProfileData[] = [
  {
    index: "08",
    name: "Shekhar Mehta",
    roles: ["President Rotary International 2021-22"],
    photo: "/images/leaders/Shekhar Mehta.png",
    biodata:
      "https://rotaryindia.org/assets/pdf/Profile_Shekhar_Mehta_RotaryInternationalPresdient.pdf",
    video: "https://youtu.be/4_CKga8LJNA",
    bio: (
      <>
        <p>
          Shekhar Mehta, of the Rotary Club of Calcutta-Mahanagar, West Bengal, India, is the
          President of Rotary International for 2021-22. Mehta acknowledges that current
          membership trends are a challenge and says that membership development should be
          Rotary’s highest priority. He believes that focusing on regional plans,
          successfully transitioning Rotaractors into Rotary clubs, and increasing diversity
          and female members could yield a 5 percent net growth in membership each year.
        </p>
        <figure className="border-l-2 border-gold py-1 pl-5">
          <blockquote className="accent-serif text-lg leading-relaxed text-navy-900">
            “A major brainstorming is needed to find effective solutions suited to different
            areas of the world”,
          </blockquote>
          <figcaption className="microlabel mt-2 !text-ink/50">
            says <cite className="not-italic">Shekhar Mehta.</cite>
          </figcaption>
        </figure>
        <p>
          He adds that regional ethos and culture have to be taken into account to find
          localized solutions, as “one size does not fit all.” He believes Rotary can extend
          to new geographical areas and countries.
        </p>
        <p>
          As a strong proponent of Rotary’s strategic plan, Mehta says he will encourage
          clubs to use action plans and reinforce the core values of Rotary.
        </p>
        <p>
          Mehta says Rotary needs to become more contemporary and adaptable by focusing on
          partnerships with governments and corporations, expanding partnerships with
          organizations that specialize in Rotary’s areas of focus, and investing in
          technology.
        </p>
        <p>
          Mehta, an accountant, is chair of the Skyline Group, a real estate development
          company he founded. He is also a director of Operation Eyesight Universal (India),
          a Canada-based organization.
        </p>
        <p>
          Mehta has been actively involved in disaster response and is a trustee of
          ShelterBox, UK. After the 2004 Indian Ocean tsunami, he helped build nearly 500
          homes for families affected by the disaster.
        </p>
        <p>
          Mehta pioneered a program that has performed more than 1,500 life-changing heart
          surgeries in South Asia. He is also the architect of the TEACH Program, which
          promotes literacy throughout India and has reached thousands of schools.
        </p>
        <p>
          A Rotary member since 1984, Mehta has served Rotary as director, member or chair of
          several committees, zone coordinator, training leader, member of The Rotary
          Foundation Cadre of Technical Advisers, and district governor. He is also the chair
          of Rotary Foundation (India).
        </p>
        <p>
          Mehta has received Rotary’s Service Above Self Award and The Rotary Foundation’s
          Citation for Meritorious Service and Distinguished Service Awards.
        </p>
      </>
    ),
  },
  {
    index: "09",
    name: "K R Ravindran",
    roles: ["President Rotary International 2015-16"],
    photo: "/images/leaders/kr-ravindran.png",
    biodata: "https://rotaryindia.org/assets/pdf/KR-Ravindran-biodata.pdf",
    bio: (
      <>
        <p>
          K.R. “Ravi” Ravindran, a distinguished business leader from Colombo, Sri Lanka,
          served as the 105th President of Rotary International during the 2015-2016 term,
          marking the first time a Sri Lankan held this prestigious position. As a member of
          the Rotary Club of Colombo since 1974, Ravindran has been deeply committed to
          Rotary’s mission of humanitarian service.
        </p>
        <p>
          Professionally, Ravindran is the founder and CEO of Printcare PLC, a publicly
          listed company recognized as a global leader in the tea packaging industry. Under
          his leadership, Printcare has garnered numerous national and international
          accolades for excellence. Beyond his corporate endeavors, he has contributed to
          various boards and charitable trusts, including serving as the founding president
          of the Sri Lanka Anti-Narcotics Association, the nation’s leading anti-narcotics
          organization.
        </p>
        <p>
          During Sri Lanka’s civil unrest, Ravindran played a pivotal role as the national
          PolioPlus chair, leading a task force comprising government officials, UNICEF, and
          Rotary representatives. His efforts were instrumental in negotiating a ceasefire
          with northern militants, facilitating National Immunization Days, and contributing
          to Sri Lanka becoming polio-free in 1994.
        </p>
        <p>
          In the aftermath of the 2004 Indian Ocean tsunami, Ravindran chaired the Schools
          Reawakening project, successfully raising over $12 million to rebuild 25 schools,
          benefiting nearly 15,000 children.
        </p>
        <p>
          Throughout his Rotary tenure, Ravindran has held numerous leadership roles,
          including RI treasurer, director, and Foundation trustee. He and his wife, Vanathy,
          are Level 4 Major Donors to The Rotary Foundation, reflecting their deep commitment
          to Rotary’s philanthropic initiatives.
        </p>
      </>
    ),
  },
  {
    index: "10",
    name: "Kalyan Banerjee",
    roles: ["Past RI President 2011-12"],
    photo: "/images/leaders/kalyan_banerjee.png",
    biodata: "https://rotaryindia.org/pdf/Kalyan-Banerjee.pdf",
    video: "https://youtu.be/67LLxADkb7U",
    bio: (
      <>
        <p>
          Kalyan Banerjee has been marshaling his energies for Rotary since 1972, when he
          joined the fledgling club in his hometown of Vapi, India. Around the same time, the
          young chemical engineer was starting up a small company to produce red phosphorous,
          an essential ingredient in fertilizer. Under Banerjee’s leadership, United
          Phosphorous Limited blossomed into the largest agrochemical manufacturer in India.
          And Vapi, due in no small part to the work of the local Rotary club, has been
          transformed from a sleepy village into a major industrial center in Gujarat State.
        </p>
        <p>
          Over the last four decades, Banerjee has served Rotary as a district governor,
          president’s representative, committee and task force chair, Rotary Foundation
          trustee, and director. He also has been a member of the International PolioPlus
          Committee, heading up initiatives that have spurred Rotary’s polio eradication
          efforts in India.
        </p>
        <p>
          Now, almost to his own amazement, Banerjee is the organization’s 101st president
          and the third from India.
        </p>
      </>
    ),
  },
  {
    index: "11",
    name: "Rajendra K. Saboo",
    roles: ["Past RI President 1991-92"],
    photo: "/images/leaders/rajendra_saboo.png",
    biodata: "https://rotaryindia.org/pdf/Rajendra-k-Saboo.pdf",
    bio: (
      <>
        <p>
          Rajendra K. Saboo is Chairman of Saboo Business Group which includes Kamla Dials
          and Devices Limited a leading manufacturer of ornamental watch dials and watch
          components, Saboo Coatings Limited manufacturing specialised lacquers and surface
          coatings and ETHOS, high-end watch retail boutique chain.
        </p>
        <p>
          Having joined Rotary Club of Chandigarh in 1961, he continues to be a member and
          past president of Rotary Club of Chandigarh. He has served Rotary International in
          many capacities and to name a few of his formal positions, he has been District
          Governor, Chairman and/or member of various R.I. Committees in different years,
          International Assembly Discussion Leader, R.I. Director, R.I. President, Chairman
          of The Rotary Foundation Trustees and Trustee of The Rotary Foundation.
        </p>
        <p>
          Saboo is Past President of the PHD Chamber of Commerce and Industry, the premier
          business and industry association of North India. He is also a member of the
          Managing Committee of Federation of Indian Chambers of Commerce and Industry
          (FICCI). He is associated with many other trade and industrial associations as
          Committee Member or Special Invitee. He has been founder Chairman of CII (Northern
          region), and Chairman of All India Manufacturers’ Organisation (Delhi and Punjab
          Chapter).
        </p>
        <p>
          Since 1998 he has been serving hands-on as volunteers in Rotary Medicare projects
          in Africa, and has worked in Uganda, Ethiopia, Nigeria, Zambia & Malawi, Swaziland,
          Cambodia, Madagascar and Lesotho.
        </p>
        <p>
          “Padma Shri” Award, was conferred upon Mr. Saboo by the President of India in
          March, 2006. During 2005, he had been conferred a Degree of Doctor of Letters
          (Honoris Causa) by H.N.Bahuguna Garhwal University, Srinagar, Uttrakhand. During
          2007, he has again been conferred a Degree of Doctor of Literature (Honoris Causa)
          by Panjab University which is the fourth oldest University in India He has been
          recipient of several honours, recognitions and awards from Rotary and non-Rotary
          organizations.
        </p>
      </>
    ),
  },
];
