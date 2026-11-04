-- ROW has no built-in tax: new website pricing rows default to 0%. Existing rows keep their value.
ALTER TABLE club_website_pricing ALTER COLUMN GstPercent SET DEFAULT 0.00;
