// Shared "I Agree" disclaimer text, keyed by service avenue. Shown BEFORE
// navigating to the Add form (the gate lives on the listing, not the add page).
// Kept in sync with each module listing page's own AGREE_MESSAGE constant.
export const AGREE_MESSAGES: Record<string, string> = {
  club_service: `The data I will enter is for a Meeting / Event conducted by my club. E.g., Installation, Navratri Celebration, Weekly Meetings, Etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  community_service: `The data I will enter is for a Community service project conducted by my club that has benefitted my community. E.g., Heart Surgeries, Tree Plantation, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  vocational_service: `The data I will enter is for a Vocational service project conducted by my club that has benefitted my community. E.g., Career Guidance and Skill Development, Computer Literacy, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  international_service: `The data I will enter is for a International Service project conducted by my club that has benefitted my community. E.g., Rotary Youth Exchange, Rotary Friendship Exchange, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  new_generation_service: `The data I will enter is for a New generation Service Project conducted by my club that has benefitted my community. E.g., Formation of an Interact Club, Formation of a Rotaract Club, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
  public_image_initiative: `The data I will enter is for a Public Image Initiative conducted by my club. E.g., Hoardings, Marathons, Rotary Stories on News Papers / Radio / TV ads, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`,
};
