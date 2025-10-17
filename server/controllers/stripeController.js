const axios = require("axios");
const db = require("../config/db.js");

exports.createCheckoutSession = async (req, res) => {
  let connection;
  try {
    const {
      plan,
      priceID,
      paymentMethods,
      billingCycle,
      price,
      customerEmail,
      customerName,
    } = req.body;

    if (!plan || !paymentMethods || !billingCycle || !price) {
      return res
        .status(400)
        .json({ error: "Missing required fields in request body" });
    }

    // Get user info from token
    const userId = req.user?.id;
    const userEmail = req.user?.email;
    const userName = req.user?.name;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const finalCustomerEmail = customerEmail || userEmail;
    const finalCustomerName = customerName || userName;

    let stripePriceId = priceID;
    let productData = {};

    // 🔹 STEP 1: If no priceID provided, find or create the appropriate recurring price
    if (!stripePriceId) {
      
      // Search for existing recurring prices for this plan
      const searchParams = new URLSearchParams({
        query: `active:'true' AND metadata['plan_name']:'${plan}' AND recurring interval:'${billingCycle === 'yearly' ? 'year' : 'month'}'`,
        limit: '1'
      });

      const searchResponse = await axios.get(
        `${process.env.STRIPE_URL}/prices/search?${searchParams}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        }
      );

      if (searchResponse.data.data.length > 0) {
        // Use existing recurring price
        stripePriceId = searchResponse.data.data[0].id;
      } else {
        // Create a new recurring price
        
        // First, find or create the product
        const productSearchParams = new URLSearchParams({
          query: `active:'true' AND metadata['plan_name']:'${plan}'`,
          limit: '1'
        });

        const productSearchResponse = await axios.get(
          `${process.env.STRIPE_URL}/products/search?${productSearchParams}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          }
        );

        let productId;
        if (productSearchResponse.data.data.length > 0) {
          productId = productSearchResponse.data.data[0].id;
        } else {
          // Create new product
          const productParams = new URLSearchParams();
          productParams.append("name", plan);
          productParams.append("description", `${plan} Plan`);
          productParams.append("metadata[plan_name]", plan);
          
          const productResponse = await axios.post(
            `${process.env.STRIPE_URL}/products`,
            productParams,
            {
              headers: {
                Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
            }
          );
          productId = productResponse.data.id;
        }

        // Create recurring price
        const priceParams = new URLSearchParams();
        priceParams.append("product", productId);
        priceParams.append("unit_amount", Math.round(price * 100)); // Convert to cents
        priceParams.append("currency", "usd");
        priceParams.append("recurring[interval]", billingCycle === 'yearly' ? 'year' : 'month');
        priceParams.append("metadata[plan_name]", plan);
        priceParams.append("metadata[billing_cycle]", billingCycle);

        const priceResponse = await axios.post(
          `${process.env.STRIPE_URL}/prices`,
          priceParams,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );

        stripePriceId = priceResponse.data.id;
      }
    }

    // 🔹 STEP 2: Verify the price is a recurring price
    try {
      const priceRes = await axios.get(
        `${process.env.STRIPE_URL}/prices/${stripePriceId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        }
      );

      const priceData = priceRes.data;
      
      // Check if this is a recurring price
      if (priceData.type !== 'recurring') {
        return res.status(400).json({
          error: "Invalid price type for subscription",
          details: "The provided price is not a recurring price. Please use a subscription price."
        });
      }

      

      const productId = priceData.product;
      const productRes = await axios.get(
        `${process.env.STRIPE_URL}/products/${productId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        }
      );

      productData = productRes.data;

    } catch (stripeError) {
      
      return res.status(500).json({
        error: "Failed to fetch Stripe product details",
        details: stripeError.response?.data || stripeError.message,
      });
    }

    // 🔹 STEP 3: Create or reuse a Stripe customer
    let customerId;
    try {
      const params = new URLSearchParams();
      if (finalCustomerEmail) params.append("email", finalCustomerEmail);
      if (finalCustomerName) params.append("name", finalCustomerName);
      params.append("metadata[user_id]", userId.toString());
      params.append("metadata[plan_name]", plan);

      const customerResponse = await axios.post(
        `${process.env.STRIPE_URL}/customers`,
        params,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      customerId = customerResponse.data.id;
    } catch (customerError) {
      
      return res.status(500).json({
        error: "Failed to create Stripe customer",
        details: customerError.response?.data || customerError.message,
      });
    }

    // 🔹 STEP 4: Create checkout session with the recurring price
    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append(
      "success_url",
      `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`
    );
    params.append("cancel_url", `${process.env.FRONTEND_URL}/failure`);
    params.append("customer", customerId);
    params.append("line_items[0][price]", stripePriceId);
    params.append("line_items[0][quantity]", "1");

    params.append("metadata[user_id]", userId);
    params.append("metadata[plan_name]", plan);
    params.append("subscription_data[metadata][user_id]", userId);
    params.append("subscription_data[metadata][plan_name]", plan);
    params.append("customer_update[address]", "auto");

    (paymentMethods.length > 0 ? paymentMethods : ["card"]).forEach(
      (pm, idx) => {
        params.append(`payment_method_types[${idx}]`, pm);
      }
    );


    const response = await axios.post(
      `${process.env.STRIPE_URL}/checkout/sessions`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const session = response.data;

    // 🔹 STEP 5: Save payment + plan metadata to DB
    connection = await db.getConnection();
    const safeValue = (v) => (v === undefined ? null : v);

    await connection.execute(
      `INSERT INTO stripe_payments (
        stripe_session_id,
        plan_name,
        billing_cycle,
        amount,
        currency,
        payment_status,
        customer_email,
        customer_name,
        payment_method_types,
        user_id,
        stripe_customer_id,
        stripe_price_id,
        stripe_product_id,
        product_name,
        product_description,
        product_features,
        product_image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeValue(session.id),
        safeValue(plan),
        safeValue(billingCycle),
        safeValue(price),
        "usd",
        "pending",
        safeValue(finalCustomerEmail),
        safeValue(finalCustomerName),
        JSON.stringify(paymentMethods || []),
        safeValue(userId),
        safeValue(customerId),
        safeValue(stripePriceId),
        safeValue(productData.id),
        safeValue(productData.name),
        safeValue(productData.description),
        JSON.stringify(productData.marketing_features || []),
        productData.images?.[0] || null,
      ]
    );

    connection.release();

    res.json({
      url: session.url,
      sessionId: session.id,
      product: {
        name: productData.name,
        description: productData.description,
        features: productData.marketing_features,
        image: productData.images?.[0] || null,
      },
    });
  } catch (error) {
    if (connection) connection.release();
    console.error("Stripe error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.response?.data || error.message,
    });
  }
};


exports.handlePaymentSuccess = async (req, res) => {
  let connection;
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // 🔹 STEP 1: Retrieve checkout session
    const sessionResponse = await axios.get(
      `${process.env.STRIPE_URL}/checkout/sessions/${session_id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        },
      }
    );
    const session = sessionResponse.data;

    if (!session.subscription) {
      return res
        .status(400)
        .json({ error: "No subscription found in session" });
    }

    // 🔹 STEP 2: Retrieve subscription details
    const subscriptionResponse = await axios.get(
      `${process.env.STRIPE_URL}/subscriptions/${session.subscription}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        },
      }
    );
    const subscription = subscriptionResponse.data;

    // 🔹 STEP 3: Try to get the related invoice
    let invoicePdf = null;
    let invoiceNumber = null;
    let invoiceId = null;

    if (subscription.latest_invoice) {
      try {
        const invoiceResponse = await axios.get(
          `${process.env.STRIPE_URL}/invoices/${subscription.latest_invoice}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          }
        );
        const invoice = invoiceResponse.data;
        invoicePdf = invoice.invoice_pdf;
        invoiceNumber = invoice.number;
        invoiceId = invoice.id;
      } catch (invoiceError) {
        console.warn(
          "Failed to fetch latest invoice, trying session invoice..."
        );
        if (session.invoice) {
          try {
            const invoiceResponse = await axios.get(
              `${process.env.STRIPE_URL}/invoices/${session.invoice}`,
              {
                headers: {
                  Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                },
              }
            );
            const invoice = invoiceResponse.data;
            invoicePdf = invoice.invoice_pdf;
            invoiceNumber = invoice.number;
            invoiceId = invoice.id;
          } catch (secondError) {
            console.error(
              "Unable to fetch invoice details:",
              secondError.message
            );
          }
        }
      }
    }

    // 🔹 STEP 4: Get customer info (may not exist in DB yet)
    let customer = null;
    if (session.customer) {
      try {
        const customerResponse = await axios.get(
          `${process.env.STRIPE_URL}/customers/${session.customer}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          }
        );
        customer = customerResponse.data;
      } catch (custErr) {
        console.warn("Failed to fetch Stripe customer:", custErr.message);
      }
    }

    // 🔹 STEP 5: Update local database with full payment info
    connection = await db.getConnection();
    const safeValue = (val) => (val === undefined ? null : val);

    const [existingPayment] = await connection.execute(
      `SELECT * FROM stripe_payments WHERE stripe_session_id = ?`,
      [session_id]
    );

    if (existingPayment.length === 0) {
      console.warn("⚠️ No existing payment found, creating fallback record...");
      await connection.execute(
        `INSERT INTO stripe_payments (
          stripe_session_id, plan_name, billing_cycle, amount, currency, payment_status,
          customer_email, stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
          invoice_number, invoice_pdf, subscription_status, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          safeValue(session.id),
          safeValue(session.metadata?.plan_name || "Unknown"),
          "unknown",
          0,
          "usd",
          safeValue(session.payment_status || "paid"),
          safeValue(session.customer_details?.email || customer?.email || null),
          safeValue(session.customer || customer?.id || null),
          safeValue(session.subscription || null),
          safeValue(invoiceId),
          safeValue(invoiceNumber),
          safeValue(invoicePdf),
          safeValue(subscription.status || null),
          safeValue(session.metadata?.user_id || null),
        ]
      );
    } else {
      await connection.execute(
        `UPDATE stripe_payments 
         SET payment_status = ?,
             stripe_customer_id = ?,
             stripe_subscription_id = ?,
             stripe_invoice_id = ?,
             invoice_number = ?,
             invoice_pdf = ?,
             subscription_status = ?,
             customer_email = COALESCE(?, customer_email),
             customer_name = COALESCE(?, customer_name),
             current_period_start = FROM_UNIXTIME(?),
             current_period_end = FROM_UNIXTIME(?),
             updated_at = CURRENT_TIMESTAMP
         WHERE stripe_session_id = ?`,
        [
          safeValue(session.payment_status),
          safeValue(session.customer || customer?.id),
          safeValue(session.subscription),
          safeValue(invoiceId),
          safeValue(invoiceNumber),
          safeValue(invoicePdf),
          safeValue(subscription.status),
          safeValue(session.customer_details?.email || customer?.email || null),
          safeValue(customer?.name || null),
          safeValue(subscription.current_period_start),
          safeValue(subscription.current_period_end),
          safeValue(session_id),
        ]
      );
    }

    // 🔹 STEP 6: Fetch the updated record to return to client
    const [paymentRecords] = await connection.execute(
      `SELECT * FROM stripe_payments WHERE stripe_session_id = ?`,
      [session_id]
    );

    connection.release();

    const payment = paymentRecords[0];

    // 🔹 STEP 6.1: Add to user_subscription_details after confirming payment
    const planMinutesMap = {
      Professional: 900,
      "Professional Plus": 2000,
      Business: 4500,
      "Business Plus": 7000,
    };

    // Determine total and monthly minutes based on billing cycle
    let totalMinutes = planMinutesMap[payment.plan_name] || 0;
    let remainingTime = totalMinutes;
    let usedTime = 0;
    let monthlyLimit = planMinutesMap[payment.plan_name] || 0;
    let monthlyUsed = 0;
    let monthlyRemaining = monthlyLimit;

    if (payment.billing_cycle === "yearly") {
      totalMinutes = monthlyLimit * 12;
      remainingTime = totalMinutes;
      usedTime = 0;

      monthlyLimit = planMinutesMap[payment.plan_name];
      monthlyUsed = 0;
      monthlyRemaining = monthlyLimit;
    }

    // Check if record already exists (to avoid duplicates)
    const [existingSubscription] = await db.execute(
      `SELECT * FROM user_subscription_details WHERE user_id = ?`,
      [payment.user_id]
    );

    if (existingSubscription.length === 0 && totalMinutes > 0) {
      await db.execute(
        `INSERT INTO user_subscription_details 
      (user_id, stripe_payment_id, total_minutes, total_remaining_time, total_used_time, monthly_limit, monthly_used, monthly_remaining) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.user_id,
          payment.id,
          totalMinutes,
          remainingTime,
          usedTime,
          monthlyLimit,
          monthlyUsed,
          monthlyRemaining,
        ]
      );
    } else {
      await db.execute(
        `UPDATE user_subscription_details 
     SET stripe_payment_id = ?, 
         total_minutes = ?, 
         total_remaining_time = ?, 
         total_used_time = ?, 
         monthly_limit = ?, 
         monthly_used = ?, 
         monthly_remaining = ? 
     WHERE user_id = ?`,
        [
          payment.id,
          totalMinutes,
          remainingTime,
          usedTime,
          monthlyLimit,
          monthlyUsed,
          monthlyRemaining,
          payment.user_id,
        ]
      );
    }

    res.json({
      success: true,
      message: "Payment confirmed successfully",
      payment: {
        id: payment.id,
        plan_name: payment.plan_name,
        billing_cycle: payment.billing_cycle,
        amount: payment.amount,
        currency: payment.currency,
        payment_status: payment.payment_status,
        customer_email: payment.customer_email,
        customer_name: payment.customer_name,
        stripe_customer_id: payment.stripe_customer_id,
        stripe_subscription_id: payment.stripe_subscription_id,
        stripe_invoice_id: payment.stripe_invoice_id,
        invoice_number: payment.invoice_number,
        invoice_pdf: payment.invoice_pdf,
        subscription_status: payment.subscription_status,
        current_period_start: payment.current_period_start,
        current_period_end: payment.current_period_end,
        created_at: payment.created_at,
      },
    });
  } catch (error) {
    if (connection) connection.release();
    console.error(
      "Payment success error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to confirm payment",
      details: error.response?.data || error.message,
    });
  }
};

// Get user's subscription details
exports.getSubscriptionDetails = async (req, res) => {
  let connection;
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    connection = await db.getConnection();

    const [subscriptions] = await connection.execute(
      `SELECT * FROM stripe_payments 
       WHERE user_id = ? AND stripe_subscription_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (subscriptions.length === 0) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const subscription = subscriptions[0];

    let stripeSubscription = null;
    let upcomingInvoice = null;

    try {
      // Get latest subscription data from Stripe
      const subscriptionResponse = await axios.get(
        `${process.env.STRIPE_URL}/subscriptions/${subscription.stripe_subscription_id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        }
      );
      stripeSubscription = subscriptionResponse.data;

      // Get upcoming invoice if subscription is active
      if (subscription.subscription_status === "active") {
        const invoiceResponse = await axios.get(
          `${process.env.STRIPE_URL}/invoices/upcoming?customer=${subscription.stripe_customer_id}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          }
        );
        upcomingInvoice = invoiceResponse.data;
      }
    } catch (stripeError) {
      console.error("Stripe API error:", stripeError.message);
      // Continue with basic subscription data
    }

    connection.release();

    res.json({
      success: true,
      data: {
        ...subscription,
        stripe_subscription: stripeSubscription,
        upcoming_invoice: upcomingInvoice,
      },
    });
  } catch (error) {
    if (connection) connection.release();
    console.error("Subscription details error:", error);
    res.status(500).json({
      error: "Failed to retrieve subscription details",
    });
  }
};

// Get user's billing history
exports.getBillingHistory = async (req, res) => {
  let connection;
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    connection = await db.getConnection();

    const [payments] = await connection.execute(
      `SELECT * FROM stripe_payments 
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    connection.release();

    res.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    if (connection) connection.release();
    console.error("Billing history error:", error);
    res.status(500).json({
      error: "Failed to retrieve billing history",
    });
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res) => {
  let connection;
  try {
    const { subscriptionId } = req.body;
    const userId = req.user?.id;

    if (!subscriptionId) {
      return res.status(400).json({ error: "Subscription ID is required" });
    }

    // Verify the subscription belongs to the user
    connection = await db.getConnection();
    const [subscriptions] = await connection.execute(
      `SELECT * FROM stripe_payments WHERE stripe_subscription_id = ? AND user_id = ?`,
      [subscriptionId, userId]
    );

    if (subscriptions.length === 0) {
      connection.release();
      return res.status(404).json({ error: "Subscription not found" });
    }

    // Cancel subscription in Stripe (immediately)
    const response = await axios.delete(
      `${process.env.STRIPE_URL}/subscriptions/${subscriptionId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        },
      }
    );

    // Update database
    await connection.execute(
      `UPDATE stripe_payments SET subscription_status = 'canceled' WHERE stripe_subscription_id = ?`,
      [subscriptionId]
    );

    connection.release();

    res.json({
      success: true,
      message: "Subscription cancelled successfully",
    });
  } catch (error) {
    if (connection) connection.release();
    console.error(
      "Cancel subscription error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to cancel subscription",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};
