import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { LndNodeModel, PostModel, UserModel } from "./models";
import nodeManager from "./node-manager";
import db from "./posts-db";

// POST /api/connect
// Connect to an LndNode
export const connect = async (req: Request, res: Response) => {
  try {
    const { host, cert, macaroon } = req.body;
    const { token, pubkey } = await nodeManager.connect(host, cert, macaroon);
    const node = new LndNodeModel({ host, cert, macaroon, token, pubkey });
    await node.save();
    res.status(201).send(node);
  } catch (err) {
    res.status(500).send(err);
  }
};

// GET /api/info
// Get info from an LndNode
export const getInfo = async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    throw new Error("Your node is not connected");
  }

  // Find the node making the request
  const node = await LndNodeModel.findOne({ token }).exec();
  if (!node) {
    throw new Error("Node not found with this token");
  }

  // Get node's pubkey and alias
  const rpc = nodeManager.getRpc(node.token);
  const { alias, identityPubkey: pubkey } = await rpc.getInfo();
  const { balance } = await rpc.channelBalance();
  res.send({ alias, balance, pubkey });
};

// GET /api/posts
export const getPosts = async (req: Request, res: Response) => {
  try {
    const posts = await PostModel.find({});
    res.send(posts);
  } catch (err) {
    res.status(500).send(err);
  }
};

// POST /api/posts
export const createPost = async (req: Request, res: Response) => {
  try {
    const post = new PostModel(req.body);
    await post.save();
    res.status(201).send(post);
  } catch (err) {
    res.status(500).send(err);
  }
};

// POST /api/posts/:id/upvote
// TODO: Rework this into pay-to-read logic
export const upvotePost = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { hash } = req.body;

  // Validate that an invoice hash was provided
  if (!hash) {
    throw new Error("Hash is required");
  }

  // Find the post
  const post = await PostModel.findById(id).exec();
  if (!post) {
    throw new Error("Post not found");
  }

  // Find the node that made this post
  // TODO: Go through post.user.node, since posts no longer have pubkeys
  const node = await LndNodeModel.findOne({}).exec();
  if (!node) {
    throw new Error("Node not found for this post");
  }

  const rpc = nodeManager.getRpc(node.token);
  const rHash = Buffer.from(hash, "base64");
  const { settled } = await rpc.lookupInvoice({ rHash });
  if (!settled) {
    throw new Error("The payment has not been paid yet");
  }

  db.upvotePost(post.id);
  res.send(post);
};

// POST /api/posts/:id/invoice
export const postInvoice = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Find the post
  const post = await PostModel.findById(id).exec();
  if (!post) {
    throw new Error("Post not found.");
  }

  // TODO: Go through post.user.node, since posts no longer have pubkeys
  const node = await LndNodeModel.findOne({}).exec();
  if (!node) {
    throw new Error("Node not found for this post.");
  }

  // Create an invoice on the poster's node
  const rpc = nodeManager.getRpc(node.token);
  const amount = 100;
  const inv = await rpc.addInvoice({ value: amount.toString() });
  res.send({
    payreq: inv.paymentRequest,
    hash: (inv.rHash as Buffer).toString("base64"),
    amount,
  });
};

// POST /api/users
// Register a new user
export const createUser = async (req: Request, res: Response) => {
  try {
    // Get user input
    const { name, blog, password } = req.body;

    // Validate user input
    if (!(name && blog && password)) {
      res.status(400).send("All inputs are required.");
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ name }).exec();
    if (existingUser) {
      res.status(409).send("User already exists. Please login.");
    }

    // Encrypt password
    const encryptedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await UserModel.create({
      name,
      blog,
      password: encryptedPassword,
    });

    // Create JWT token
    const jwtToken = jwt.sign(
      { user_id: newUser._id, name },
      process.env.TOKEN_KEY as string,
      { expiresIn: "2h" }
    );

    // Save JWT token to the new user
    newUser.jwtToken = jwtToken;

    // Return the new user
    res.status(201).send(newUser);
  } catch (err) {
    console.error(err)
    if (err instanceof Error) {
      throw new Error(err.message)
    } else {
      console.warn(err)
    }
  }
};

// POST /api/login
export const login = async (req: Request, res: Response) => {};
