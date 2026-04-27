// UK
const API_ENDPOINTS_UK = {
    JOBCARDAPI: "https://www.jobsatamazon.co.uk/graphql",
    SCHEDULEAPI: "https://www.jobsatamazon.co.uk/graphql",
};

// Today's date in UTC, YYYY-MM-DD. Computed at request time so the body stays fresh.
function todayUTC() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const HEADERS_CONFIG_UK = {
    // Job Card API Headers
    JOBCARDAPI_HEADERS: {
        "accept": "*/*",
        "accept-language": "en-GB,en;q=0.9",
        "authorization": "Bearer Status|unauthenticated|Session|eyJhbGciOiJLTVMiLCJ0eXAiOiJKV1QifQ.eyJpYXQiOjE3NzcyMzYxNjUsImV4cCI6MTc3NzIzOTc2NX0.AQICAHgRVX6yB5HaOXG/6jWEErD4AnJUVlc3se+5PoiAFFV3IgEC9v8G8s/sJUuPQbi+uymvAAAAtDCBsQYJKoZIhvcNAQcGoIGjMIGgAgEAMIGaBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDErI1b3/2JzzHhwwKwIBEIBttyVag6tuT02IHzI3tN3TcEcYSGwF5PIcSxnIcR0NpTmYQwrUEwYO1xR0OewqBMErU4Ss/DIlUL+VxlhIOoSGr8pROBC9GyfMlGs1bNDnvFVythQTF+UcaX73R0td0l26oTu95HT4mvLjLFrc0Q==",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "country": "United Kingdom",
        "iscanary": "false",
        "origin": "https://www.jobsatamazon.co.uk",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "referer": "https://www.jobsatamazon.co.uk/app",
        "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "cookie": [
            "hvh-locale=en-GB",
            "hvh-default-locale=en-GB",
            "hvh-country-code=UK",
            "hvh-stage=prod",
            "adobe-session-id=8ed79696-fad1-426b-8e3c-1ccfaf4a9230",
            "hvh-advertising-cookies-enable=false",
            "hvh-analytics-cookies-enable=false",
            'hvh_cs_wlbsid=""',
            "aws-waf-token=8ad5e0c5-4198-4b22-925d-97bbb05363be:BQoAgRuP83MOAAAA:QO4mKVT4ZZp9iIfFa/lknqtlp1KXF/FOBG0SuS5JUcglRO9Eab/8BXxtQufG+L13peGvaUE9INGJqRODIaoK4Z+VXAEj2BLxF/fC9P0SWUi6uI3+Gg4KqDAoJPJ8MuTC7ZcdIqyiDJgZri3xCpjpMzRnyQrRrAH3E1KNRfojGxlaEw7EKOV9ThsDpSK5ueXKmu8wIM+NZqo0RI2AclG20NhK61wdAdxiWxmlLI3gJ0MjLH6Hyufguuhc+d+Gk5Y=",
            "JSESSIONID=2A016FE0FA2D5E89568BD1F8B95ADE77",
        ].join("; "),
    },
    // Job Card API Body
    JOBCARDAPI_BODY: JSON.stringify({
        query: "query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {\n  searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {\n    nextToken\n    jobCards {\n      jobId\n      language\n      dataSource\n      requisitionType\n      jobTitle\n      jobType\n      employmentType\n      city\n      state\n      postalCode\n      locationName\n      totalPayRateMin\n      totalPayRateMax\n      tagLine\n      bannerText\n      image\n      jobPreviewVideo\n      distance\n      featuredJob\n      bonusJob\n      bonusPay\n      scheduleCount\n      currencyCode\n      geoClusterDescription\n      surgePay\n      jobTypeL10N\n      employmentTypeL10N\n      bonusPayL10N\n      surgePayL10N\n      totalPayRateMinL10N\n      totalPayRateMaxL10N\n      distanceL10N\n      monthlyBasePayMin\n      monthlyBasePayMinL10N\n      monthlyBasePayMax\n      monthlyBasePayMaxL10N\n      jobContainerJobMetaL1\n      virtualLocation\n      poolingEnabled\n      payFrequency\n      jobLocationType\n      internalStaffingOrgId\n      agencyName\n      __typename\n    }\n    __typename\n  }\n}\n",
        variables: {
            searchJobRequest: {
                locale: "en-GB",
                country: "United Kingdom",
                keyWords: "",
                equalFilters: [],
                containFilters: [
                    {
                        key: "isPrivateSchedule",
                        val: ["true", "false"],
                    },
                ],
                rangeFilters: [],
                orFilters: [],
                dateFilters: [],
                sorters: [
                    {
                        fieldName: "totalPayRateMax",
                        ascending: "false",
                    },
                ],
                pageSize: 100,
                consolidateSchedule: true,
            },
        },
    }),
    // Schedule API Headers — same auth/cookies as JobCard since it's the same UK session.
    SCHEDULEAPI_HEADERS: {
        "accept": "*/*",
        "accept-language": "en-GB,en;q=0.9",
        "authorization": "Bearer Status|unauthenticated|Session|eyJhbGciOiJLTVMiLCJ0eXAiOiJKV1QifQ.eyJpYXQiOjE3NzcyMzYxNjUsImV4cCI6MTc3NzIzOTc2NX0.AQICAHgRVX6yB5HaOXG/6jWEErD4AnJUVlc3se+5PoiAFFV3IgEC9v8G8s/sJUuPQbi+uymvAAAAtDCBsQYJKoZIhvcNAQcGoIGjMIGgAgEAMIGaBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDErI1b3/2JzzHhwwKwIBEIBttyVag6tuT02IHzI3tN3TcEcYSGwF5PIcSxnIcR0NpTmYQwrUEwYO1xR0OewqBMErU4Ss/DIlUL+VxlhIOoSGr8pROBC9GyfMlGs1bNDnvFVythQTF+UcaX73R0td0l26oTu95HT4mvLjLFrc0Q==",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "country": "United Kingdom",
        "iscanary": "false",
        "origin": "https://www.jobsatamazon.co.uk",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "referer": "https://www.jobsatamazon.co.uk/app",
        "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "cookie": [
            "hvh-locale=en-GB",
            "hvh-default-locale=en-GB",
            "hvh-country-code=UK",
            "hvh-stage=prod",
            "adobe-session-id=8ed79696-fad1-426b-8e3c-1ccfaf4a9230",
            "hvh-advertising-cookies-enable=false",
            "hvh-analytics-cookies-enable=false",
            'hvh_cs_wlbsid=""',
            "aws-waf-token=8ad5e0c5-4198-4b22-925d-97bbb05363be:BQoAgRuP83MOAAAA:QO4mKVT4ZZp9iIfFa/lknqtlp1KXF/FOBG0SuS5JUcglRO9Eab/8BXxtQufG+L13peGvaUE9INGJqRODIaoK4Z+VXAEj2BLxF/fC9P0SWUi6uI3+Gg4KqDAoJPJ8MuTC7ZcdIqyiDJgZri3xCpjpMzRnyQrRrAH3E1KNRfojGxlaEw7EKOV9ThsDpSK5ueXKmu8wIM+NZqo0RI2AclG20NhK61wdAdxiWxmlLI3gJ0MjLH6Hyufguuhc+d+Gk5Y=",
            "JSESSIONID=2A016FE0FA2D5E89568BD1F8B95ADE77",
        ].join("; "),
    },
    // Schedule API Body — takes a jobId, returns the JSON-stringified body for that jobId.
    SCHEDULEAPI_BODY: function (jobId) {
        return JSON.stringify({
            operationName: "searchScheduleCards",
            variables: {
                searchScheduleRequest: {
                    locale: "en-GB",
                    country: "United Kingdom",
                    keyWords: "",
                    equalFilters: [],
                    containFilters: [
                        { key: "isPrivateSchedule", val: ["true", "false"] },
                    ],
                    rangeFilters: [
                        { key: "hoursPerWeek", range: { minimum: 0, maximum: 80 } },
                    ],
                    orFilters: [],
                    dateFilters: [
                        { key: "firstDayOnSite", range: { startDate: todayUTC() } },
                    ],
                    sorters: [
                        { fieldName: "totalPayRateMax", ascending: "false" },
                    ],
                    pageSize: 1000,
                    jobId: jobId,
                    consolidateSchedule: true,
                },
            },
            query: "query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) {\n  searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) {\n    nextToken\n    scheduleCards {\n      hireStartDate\n      address\n      basePay\n      bonusSchedule\n      city\n      currencyCode\n      dataSource\n      distance\n      employmentType\n      externalJobTitle\n      featuredSchedule\n      firstDayOnSite\n      hoursPerWeek\n      image\n      jobId\n      jobPreviewVideo\n      language\n      postalCode\n      priorityRank\n      scheduleBannerText\n      scheduleId\n      scheduleText\n      scheduleType\n      signOnBonus\n      state\n      surgePay\n      tagLine\n      geoClusterId\n      geoClusterName\n      siteId\n      scheduleBusinessCategory\n      totalPayRate\n      financeWeekStartDate\n      laborDemandAvailableCount\n      scheduleBusinessCategoryL10N\n      firstDayOnSiteL10N\n      financeWeekStartDateL10N\n      scheduleTypeL10N\n      employmentTypeL10N\n      basePayL10N\n      signOnBonusL10N\n      totalPayRateL10N\n      distanceL10N\n      requiredLanguage\n      monthlyBasePay\n      monthlyBasePayL10N\n      vendorKamName\n      vendorId\n      vendorName\n      kamPhone\n      kamCorrespondenceEmail\n      kamStreet\n      kamCity\n      kamDistrict\n      kamState\n      kamCountry\n      kamPostalCode\n      payFrequency\n      __typename\n    }\n    __typename\n  }\n}\n",
        });
    },
};

const TIMING = {
    API_RELOAD: 200,
};

const API_CONFIG = {
    TIMING,
    API_ENDPOINTS_UK,
    HEADERS_CONFIG_UK,
};

module.exports = { API_CONFIG };
