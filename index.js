require("dotenv").config();

// Config
const startDate = "2024-01-29"; // YYYY-MM-DD format
const stayLengthDays = 5;
const partySize = 2;
const checkIntervalMs = 10000;

const enableSMS = false;
const enablePush = true;

// place target names in here, the rest is Disney Magic 🪄 (must exact match mousedining.com)
const restaurantNames = [
  "Victoria & Albert's The Dining Room",
  "Victoria & Albert's Queen Victoria Room",
  "Space 220",
  "Space 220 Lounge",
];

const PHONE_NUMBERS = process.env.TWILIO_SMS_TO.split("&");

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const client = require("twilio")(
  process.env.TWILIO_SMS_ID,
  process.env.TWILIO_SMS_TOKEN
);
const Pushover = require("node-pushover");

const push = new Pushover({
  token: process.env.PUSHOVER_TOKEN,
  user: process.env.PUSHOVER_USER,
});

const sendNotif = (restName, date, breakfast, brunch, lunch, dinner, link) => {
  if (!enablePush) return;

  const getBody = (label, value) =>
    ["0", 0].includes(value) ? "" : `${label}: ${value}`;

  const availabilityBody = [
    getBody("Breakfast", breakfast),
    getBody("Brunch", brunch),
    getBody("Lunch", lunch),
    getBody("Dinner", dinner),
  ]
    .filter((r) => !!r)
    .join(" ")
    .trim();

  const formattedDate = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00-06:00`));

  push.send(
    `🔴 🍽️ ${restName}`,
    `${formattedDate} - ${availabilityBody} \n\n${link}`
  );
};

const SMS_THRES = 5;
const SMS_PAUSE_MINUTES = 3;
const SMS_CYCLE_MINUTES = 5;

let checkCount = 0;
let currentCycleSMSSent = 0;
let isSMSPaused = false;

const sendSMS = (body) => {
  if (!enableSMS) return;

  return Promise.all(
    PHONE_NUMBERS.map((to) =>
      client.messages.create({
        body,
        from: process.env.TWILIO_SMS_FROM,
        to,
      })
    )
  );
};

const pauseSMS = () => {
  isSMSPaused = true;
  sendSMS(`Pausing SMS send for ${SMS_PAUSE_MINUTES} minutes`);
  setTimeout(() => {
    sendSMS(`Unpausing SMS`);
    isSMSPaused = false;
    currentCycleSMSSent = 0;
  }, SMS_PAUSE_MINUTES * 60 * 1000);
};

setInterval(() => {
  currentCycleSMSSent = 0;
}, SMS_CYCLE_MINUTES * 60 * 1000);

const sendReservationSMS = (
  restaurant,
  date,
  breakfast,
  brunch,
  lunch,
  dinner,
  link
) => {
  if (isSMSPaused) return;
  currentCycleSMSSent++;
  if (currentCycleSMSSent >= SMS_THRES) pauseSMS();

  return sendSMS(
    `Availability detected for ${restaurant} on ${date}:\nBreakfast: ${breakfast}\nBrunch: ${brunch}\nLunch: ${lunch}\nDinner: ${dinner}\n\n${link}`
  );
};

const buildReservationUrl = (restCode) =>
  `https://mousedining.com/v1/openings/${startDate}%7C${restCode}%7C${partySize}%7C${stayLengthDays}`;

const recordOpening = (name, opening) => {
  const reservationLogPath = path.join(
    __dirname,
    "reservation-openings-log.txt"
  );

  const openingLog = `${name} - ${opening.Date} Breakfast: ${
    opening.MealOpenings.Breakfast || 0
  } Brunch: ${opening.MealOpenings.Brunch || 0} Lunch: ${
    opening.MealOpenings.Lunch || 0
  } Dinner: ${opening.MealOpenings.Dinner || 0}`;

  console.log("Found opening", openingLog);

  const log = `${new Intl.DateTimeFormat("en", {
    timeStyle: "short",
    dateStyle: "short",
  }).format(new Date())} - Check ${checkCount} - ${openingLog}\n`;
  fs.appendFileSync(reservationLogPath, log);
};

const checkRestaurant = async (rest) => {
  try {
    console.log(`checking ${rest.name}`);
    const { data } = await axios(rest.requestUrl);
    const opening = data.find(
      (date) =>
        (date.MealOpenings.Breakfast && date.MealOpenings.Breakfast !== "0") ||
        (date.MealOpenings.Lunch && date.MealOpenings.Lunch !== "0") ||
        (date.MealOpenings.Dinner && date.MealOpenings.Dinner !== "0") ||
        (date.MealOpenings.Brunch && date.MealOpenings.Brunch !== "0")
    );

    if (opening) {
      recordOpening(rest.name, opening);
      sendNotif(
        rest.name,
        opening.Date,
        opening.MealOpenings.Breakfast || 0,
        opening.MealOpenings.Brunch || 0,
        opening.MealOpenings.Lunch || 0,
        opening.MealOpenings.Dinner || 0,
        rest.reservationUrl
      );
      sendReservationSMS(
        rest.name,
        opening.Date,
        opening.MealOpenings.Breakfast || 0,
        opening.MealOpenings.Brunch || 0,
        opening.MealOpenings.Lunch || 0,
        opening.MealOpenings.Dinner || 0,
        rest.reservationUrl
      );
    }
  } catch (err) {
    console.error("Error checking", rest.name);
  }
};

const setup = async () => {
  if (!enablePush && !enableSMS) console.warn("No notif targets set");

  const { data } = await axios.get("https://mousedining.com/v1/restaurants");

  const restaurants = restaurantNames
    .map((name) => {
      const rest = data.find((rest) => rest.Name === name);
      if (!rest) {
        console.warn("Restaurant not found", name);
        return null;
      }

      return {
        name,
        requestUrl: buildReservationUrl(rest.ID),
        reservationUrl: rest.DisneyUrl,
      };
    })
    .filter((r) => !!r);

  const check = () => {
    console.log(`check #${++checkCount}`);
    restaurants.forEach(checkRestaurant);
  };

  check();
  setInterval(check, checkIntervalMs);
};

setup();
