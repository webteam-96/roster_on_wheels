export interface GreetingSettings {
  isGreetingPaused?: boolean;
  greetingReviewedYearLabel?: string | null;
  currentYearLabel?: string | null;
  birthdayGreeting: string | null;
  isEnableBirthdayNotification: boolean;
  anniversaryGreeting: string | null;
  isEnableAnniversaryNotification: boolean;
  isEnableBirthdayEmail: boolean;
  birthdayEmailFrom: string | null;
  birthdayEmailSubject: string | null;
  birthdayEmailMessage: string | null;
  isEnableAnniversaryEmail: boolean;
  anniversaryEmailFrom: string | null;
  anniversaryEmailSubject: string | null;
  anniversaryEmailMessage: string | null;
}

export interface UpdateGreetingSettingsRequest {
  birthdayGreeting: string | null;
  isEnableBirthdayNotification: boolean;
  anniversaryGreeting: string | null;
  isEnableAnniversaryNotification: boolean;
  isEnableBirthdayEmail: boolean;
  birthdayEmailFrom: string | null;
  birthdayEmailSubject: string | null;
  birthdayEmailMessage: string | null;
  isEnableAnniversaryEmail: boolean;
  anniversaryEmailFrom: string | null;
  anniversaryEmailSubject: string | null;
  anniversaryEmailMessage: string | null;
}
