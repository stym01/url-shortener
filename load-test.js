import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '5s', target: 50 },  
        { duration: '10s', target: 50 }, 
        { duration: '5s', target: 0 },   
    ],
};

export default function () {
    const url = 'http://localhost:3000/TPiluFO'; 

    // Tell k6 NOT to follow the redirect over the internet
    const res = http.get(url, { redirects: 0 });

    check(res, {
        // Since we blocked redirects, the successful status code will be exactly 302
        'status is 302': (r) => r.status === 302,
        'transaction time OK': (r) => r.timings.duration < 5, // Testing for under 5ms!
    });

    sleep(0.1);
}