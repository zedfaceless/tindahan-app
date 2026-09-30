# Overview

As a software engineer, I wanted to learn mobile development because
it is the platform closest to the people I want to build for. To
learn React Native, I built the first working version of Tindahan, an
app idea of my own for public market vendors in the Philippines. Many
vendors only estimate their money each day and do not really know if
they are profiting, so the app makes recording money simple enough
for elderly and low literacy users, with large text and big buttons.

The app has two screens. On the entry screen the vendor types an
amount, a short description, chooses money in or money out, and taps
save. The dashboard screen shows today's money in, money out, and the
net, with the list of today's records, and a record can be deleted by
long pressing it. All records are saved on the phone with
AsyncStorage, so the data is still there even if the app is closed or
the phone is turned off. Labels are in Tagalog and English.

My purpose was to learn how React Native structures an app,
components, state with hooks, styling, handling touch input, and
persistent local storage on a real Android phone.

[Software Demo Video](http://youtube.link.goes.here)

# Development Environment

I developed this software using Visual Studio Code and the terminal
on Linux, with Git and GitHub for version control. The app runs on a
physical Android phone through the Expo Go app, with live reload over
WiFi during development.

The app is written in JavaScript using React Native with Expo. It
uses React hooks, useState and useEffect, for state, React Native
components for the interface, and the AsyncStorage package for
persistent local storage.

# Useful Websites

* [React Native Documentation](https://reactnative.dev/docs/getting-started)
* [Expo Documentation](https://docs.expo.dev/)
* [AsyncStorage Documentation](https://react-native-async-storage.github.io/async-storage/docs/usage)
* [React Hooks Documentation](https://react.dev/reference/react)

# Future Work

* A history screen showing past days and weekly totals
* Simple charts of income and expenses over time
* Categories for expenses like pamasahe, kuryente, and supplies
* Backup of records to the cloud so a lost phone does not lose data
