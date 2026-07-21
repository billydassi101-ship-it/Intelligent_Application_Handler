const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { v4: uuidv4 } = require('uuid');
const { upsertUser, getUserById } = require('../db/queries');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify'
  ]
}, (accessToken, refreshToken, profile, done) => {
  try {
    const userId = uuidv4();
    const user = {
      id: userId,
      google_id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      avatar: profile.photos?.[0]?.value || null,
      access_token: accessToken,
      refresh_token: refreshToken || null,
    };
    
    upsertUser.run(user);
    const savedUser = getUserById.get(userId);
    // The upsert may not return the right ID if conflict occurred, fetch by google_id
    const { getUserByGoogleId } = require('../db/queries');
    const finalUser = getUserByGoogleId.get(profile.id);
    
    return done(null, finalUser);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = getUserById.get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
