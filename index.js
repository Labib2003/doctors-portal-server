// express to use JavaScript in the server side
const express = require('express');
// cors to communicate between sites
const cors = require('cors');
// dotenv to protect sensitive info from git push
require('dotenv').config();
// jwt to secure the api's
const jwt = require('jsonwebtoken');
// mongodb
const { MongoClient, ServerApiVersion } = require('mongodb');

// creating the server
const app = express();
// when developing, the port is 5000, but when the project is hosted in heroku, it uses the env variable provided by them
const port = process.env.PORT || 5000;

// cors to communicate between sites
app.use(cors());
// json to parse stringified data back to js object
app.use(express.json());

// connecting to mongodb server with user and password using env variables
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p5bxt.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

// creating the client to interact with mongodb
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// jwt middletire function to verify the token and send appropriate data
function verifyJWT(req, res, next) {
  // the taking the auth header (Barer token...)
  const authHeader = req.headers.authorization;
  // if there is no auth header
  if (!authHeader) {
    return res.status(401).send({ message: 'UnAuthorized access' });
  }
  // splitting the auth header to separate the bearer and the token
  const token = authHeader.split(' ')[1];
  // decoding using the token and secret key
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    // if the decoding gives and error, meaning the token is invalid
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' });
    };
    // if there is no error, the decoded object is sent to the next step
    req.decoded = decoded;
    next();
  });
};

// connecting with the server
async function run() {
  try {
    await client.connect();

    // getting necessary collections form the database
    const serviceCollection = client.db('doctors-portal').collection('services');
    const bookingCollection = client.db('doctors-portal').collection('bookings');
    const userCollection = client.db('doctors-portal').collection('users');
    const doctorsCollection = client.db('doctors-portal').collection('doctors');

    async function verifyAdmin(req, res, next) {
      const requester = req.decoded.email;
      // checking if the requester is an admin or not
      const requesterAccount = await userCollection.findOne({ email: requester });
      if (requesterAccount?.role === 'admin') {
        next();
      }
      else {
        res.status(403).send({ message: 'forbidden' });
      }
    }

    // api to get all services
    app.get('/services', async (req, res) => {
      // going to service collection and putting all data in an array
      const services = await serviceCollection.find({}).project({ name: 1 }).toArray();
      res.send(services);
    });

    // api to show available slots
    app.get('/available', async (req, res) => {
      const date = req.query.date;
      const query = { date: date };

      const bookings = await bookingCollection.find(query).toArray();
      const services = await serviceCollection.find({}).toArray();

      // looping over all services
      services.forEach(service => {
        // separating the booked services
        const bookedServices = bookings.filter(booking => booking.treatment === service.name);
        // separating the slots from the booked services
        const booked = bookedServices.map(bookedService => bookedService.slot);
        // filtering the booked slots out from available services
        const availableServices = service.slots.filter(slot => !booked.includes(slot));
        // putting the updated data in services slots
        service.slots = availableServices;
      });
      res.send(services);
    });

    // getting appointments of a particular user
    app.get('/booking', verifyJWT, async (req, res) => {
      // patient email from search query
      const patientEmail = req.query.patient;
      // decoded email from jwt middletier, the logged in users token is in the authorization header
      const decodedEmail = req.decoded.email;
      // if both emails match
      if (patientEmail === decodedEmail) {
        const query = { patient: patientEmail };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      }
      // if the email or the token is wrong
      else {
        return res.status(403).send({ message: 'forbidden access' });
      }
    });

    // booking an appointment api
    app.post('/booking', async (req, res) => {
      // getting the booking info from body
      const booking = req.body;
      // checking if the same user has another appointment on the same treatment in the same day
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
      const exists = await bookingCollection.findOne(query);
      // user cant book multiple appointments on the same treatment in the same day
      if (exists) {
        return res.send({ success: false, booking: exists });
      };
      // if there is no other appointment on the treatment by the user, add the appointment in the database
      const result = await bookingCollection.insertOne(booking);
      res.send({ success: true, result });
    });

    // getting all user info, only for authorized users
    app.get('/users', verifyJWT, async (req, res) => {
      const users = await userCollection.find({}).toArray();
      res.send(users);
    });

    // checking if the user is admin
    app.get('/admin/:email', async (req, res) => {
      // taking the email from the search query
      const email = req.params.email;
      // getting the user form database
      const user = await userCollection.findOne({ email: email });
      // putting the boolean value in a variable
      const isAdmin = user.role === 'admin';
      // sending the result
      res.send({ admin: isAdmin })
    });

    // make admin api
    app.put('/users/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      // getting the email from search query
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: 'admin' },
      };
      // no upsert here
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // adding a new user api
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          plot: user
        },
      };
      // updating the user if the user exists, otherwise creating a new one
      const result = await userCollection.updateOne(filter, updatedDoc, options);
      // creating a jwt token with the email as the payload
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ result: result, token: token });
    });

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await doctorsCollection.find({}).toArray();
      res.send(result);
    });

    app.delete('/doctors/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const result = await doctorsCollection.deleteOne({email: email});
      res.send(result);
    });

    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const newDoctor = req.body;
      const result = await doctorsCollection.insertOne(newDoctor);
      res.send(result);
    });
  }
  finally {

  };
};

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello world');
});

app.listen(port, () => {
  console.log(`Server running @ port: ${port}`);
});