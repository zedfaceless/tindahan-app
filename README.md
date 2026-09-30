# Overview

As a software engineer, I wanted to learn mobile development because
it is the platform closest to the people I want to build for. To
learn React Native, I built the first working version of Tindahan, an
app idea of my own for public market vendors in the Philippines. Many
vendors only estimate their money each day and do not really know if
they are profiting, so the app makes recording money simple enough
for elderly and low literacy users, with large text and big buttons.

Vendors register with a username, their market name, an email, and a
PIN, and stay logged in after that. On the entry screen the vendor
types an amount and a short description, chooses money in or money
out, and taps save. The dashboard screen shows today's money in,
money out, and net, with the list of today's records, and a record
can be deleted by long pressing it. Every record is saved on the phone
first, so the app works in the market with no signal, and it syncs
both ways with a cloud database whenever there is internet, so a
vendor who changes phones gets all their records back after logging
in. Labels are in Tagalog and English.

My purpose was to learn how React Native structures an app,
components, state with hooks, styling, handling touch input,
persistent local storage, user accounts, and offline first syncing
with a cloud database, all on a real Android phone.

[Software Demo Video](http://youtube.link.goes.here)

# Development Environment

I developed this software using Visual Studio Code and the terminal
on Linux, with Git and GitHub for version control. The app runs on a
physical Android phone through the Expo Go app, with live reload over
WiFi during development.

The app is written in JavaScript using React Native with Expo. It
uses React hooks, useState and useEffect, for state, AsyncStorage for
local storage on the phone, and Supabase for login and a PostgreSQL
database. Row level security in the database makes sure each vendor
can only read and write their own records.

# Useful Websites

* [React Native Documentation](https://reactnative.dev/docs/getting-started)
* [Expo Documentation](https://docs.expo.dev/)
* [AsyncStorage Documentation](https://react-native-async-storage.github.io/async-storage/docs/usage)
* [Supabase Documentation](https://supabase.com/docs)
* [React Hooks Documentation](https://react.dev/reference/react)

# Future Work

* A history screen showing past days and weekly totals
* Simple charts of income and expenses over time
* Categories for expenses like pamasahe, kuryente, and supplies
* An admin dashboard for the app owner
